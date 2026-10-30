"""Run configured Python backend checks on a pull request's base and head commits."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import tomllib

from analyzer import build_impact

MAX_CONFIG_BYTES = 128 * 1024
MAX_CHECKS = 20
MAX_COMMAND_LENGTH = 2000
MAX_COMMAND_SECONDS = 900
MAX_JOB_SECONDS = 30 * 60
MAX_OUTPUT_CHARS = 5000

SECRET_PATTERNS = [
    (re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)\S+"), r"\1[redacted]"),
    (re.compile(r"\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b"), "[redacted-token]"),
    (re.compile(r"(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+"), r"\1[redacted]"),
]


def redact(text: str) -> str:
    for pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text[-MAX_OUTPUT_CHARS:]


def load_config(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size > MAX_CONFIG_BYTES:
        raise ValueError("The base branch must contain a changeguard.toml file under 128 KB.")
    config = tomllib.loads(path.read_text(encoding="utf-8"))
    python_version = str(config.get("python_version", ""))
    if not re.fullmatch(r"3\.\d{1,2}(?:\.\d{1,2})?", python_version):
        raise ValueError("changeguard.toml must set python_version, such as '3.12'.")
    checks = config.get("checks")
    if not isinstance(checks, list) or not checks or len(checks) > MAX_CHECKS:
        raise ValueError(f"changeguard.toml must define between 1 and {MAX_CHECKS} checks.")
    for index, check in enumerate(checks):
        if not isinstance(check, dict) or not isinstance(check.get("name"), str) or not isinstance(check.get("command"), str):
            raise ValueError(f"Check {index + 1} must define a name and command.")
        if not check["name"].strip() or len(check["name"]) > 200:
            raise ValueError(f"Check {index + 1} has an invalid name.")
        if not check["command"].strip() or len(check["command"]) > MAX_COMMAND_LENGTH:
            raise ValueError(f"Check {check['name']} has an invalid command.")
        directory = check.get("directory", ".")
        if not isinstance(directory, str) or len(directory) > 500:
            raise ValueError(f"Check {check['name']} has an invalid directory.")
        check["directory"] = directory
    for key in ("install_command", "setup_command", "cleanup_command"):
        value = config.get(key)
        if value is not None and (not isinstance(value, str) or len(value) > MAX_COMMAND_LENGTH):
            raise ValueError(f"{key} must be a shell command shorter than {MAX_COMMAND_LENGTH} characters.")
    return config


def _inside(root: Path, relative: str) -> Path:
    root = root.resolve()
    destination = (root / relative).resolve()
    if destination != root and root not in destination.parents:
        raise ValueError("A check directory resolved outside its checkout.")
    if not destination.is_dir():
        raise ValueError(f"Check directory does not exist: {relative}")
    return destination


def run_command(name: str, command: str, directory: Path, deadline: float) -> dict:
    remaining = max(1, int(deadline - time.monotonic()))
    timeout = min(MAX_COMMAND_SECONDS, remaining)
    started = time.monotonic()
    try:
        result = subprocess.run(
            command,
            cwd=directory,
            shell=True,
            executable="/bin/bash",
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
            env={**os.environ, "CI": "true", "PYTHONUNBUFFERED": "1"},
        )
        output = redact(f"{result.stdout}\n{result.stderr}")
        return {
            "name": name,
            "status": "passed" if result.returncode == 0 else "failed",
            "exit_code": result.returncode,
            "duration_seconds": round(time.monotonic() - started, 2),
            "output_excerpt": output,
        }
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or b""
        error = exc.stderr or b""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        if isinstance(error, bytes):
            error = error.decode("utf-8", errors="replace")
        return {
            "name": name,
            "status": "timed_out",
            "exit_code": None,
            "duration_seconds": round(time.monotonic() - started, 2),
            "output_excerpt": redact(f"{output}\n{error}"),
        }


def _run_version(version: str, root: Path, config: dict, deadline: float) -> dict[str, dict]:
    results: dict[str, dict] = {}
    install_command = config.get("install_command")
    setup_command = config.get("setup_command")
    cleanup_command = config.get("cleanup_command")
    try:
        if install_command:
            results["install"] = run_command("Install dependencies", install_command, root, deadline)
            if results["install"]["status"] != "passed":
                return results
        if setup_command:
            results["setup"] = run_command("Start test dependencies", setup_command, root, deadline)
            if results["setup"]["status"] != "passed":
                return results
        for index, check in enumerate(config["checks"]):
            if time.monotonic() >= deadline:
                results[f"check_{index}"] = {
                    "name": check["name"],
                    "status": "skipped",
                    "exit_code": None,
                    "duration_seconds": 0,
                    "output_excerpt": "The 30 minute rehearsal limit was reached.",
                }
                continue
            directory = _inside(root, check["directory"])
            results[f"check_{index}"] = run_command(check["name"], check["command"], directory, deadline)
    finally:
        if cleanup_command:
            try:
                results["cleanup"] = run_command("Stop test dependencies", cleanup_command, root, time.monotonic() + 60)
            except Exception as exc:
                results["cleanup"] = {"name": "Stop test dependencies", "status": "failed", "exit_code": None, "duration_seconds": 0, "output_excerpt": redact(str(exc))}
    return results


def _findings(checks: list[dict]) -> list[dict]:
    findings = []
    for check in checks:
        baseline = check["baseline"]
        candidate = check["candidate"]
        if baseline["status"] == "passed" and candidate["status"] != "passed":
            category, severity, title = "regression", "high", f"{check['name']} fails on the candidate"
            confidence = 0.95
        elif baseline["status"] != "passed" and candidate["status"] == "passed":
            category, severity, title = "improvement", "info", f"{check['name']} passes on the candidate"
            confidence = 0.9
        elif baseline["status"] != "passed" and candidate["status"] != "passed":
            category, severity, title = "pre_existing_failure", "medium", f"{check['name']} fails on both versions"
            confidence = 0.9
        else:
            continue
        findings.append({
            "category": category,
            "severity": severity,
            "confidence": confidence,
            "title": title,
            "description": f"Base status: {baseline['status']}. Candidate status: {candidate['status']}.",
            "file_path": None,
            "line_start": None,
            "evidence": {"check": check["name"], "baseline": baseline, "candidate": candidate},
        })
    return findings


def _write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def run(args: argparse.Namespace) -> int:
    base = Path(args.base).resolve()
    candidate = Path(args.candidate).resolve()
    report_path = Path(args.output).resolve()
    report: dict = {
        "version": 1,
        "run_id": args.run_id,
        "base_sha": args.base_sha,
        "head_sha": args.head_sha,
        "checks": [],
        "findings": [],
        "impact": {},
        "summary": {"status": "failed", "message": "Rehearsal did not complete."},
    }
    try:
        config = load_config(Path(args.config).resolve())
        base_head = subprocess.run(["git", "-C", str(base), "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
        candidate_head = subprocess.run(["git", "-C", str(candidate), "rev-parse", "HEAD"], check=True, text=True, capture_output=True).stdout.strip()
        if base_head != args.base_sha or candidate_head != args.head_sha:
            raise ValueError("The checked-out commits changed since the pull request event. Wait for the latest pull request update.")

        changed = subprocess.run(
            ["git", "-C", str(candidate), "diff", "--name-only", "--diff-filter=ACMRT", args.base_sha, args.head_sha],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.splitlines()
        report["impact"] = build_impact(candidate, changed)
        deadline = time.monotonic() + MAX_JOB_SECONDS
        base_results = _run_version("baseline", base, config, deadline)
        candidate_results = _run_version("candidate", candidate, config, deadline)
        for key in sorted(set(base_results) | set(candidate_results)):
            before = base_results.get(key, {"name": key, "status": "skipped", "exit_code": None, "duration_seconds": 0, "output_excerpt": "Not run."})
            after = candidate_results.get(key, {"name": key, "status": "skipped", "exit_code": None, "duration_seconds": 0, "output_excerpt": "Not run."})
            report["checks"].append({"name": before["name"], "baseline": before, "candidate": after})
        report["findings"] = _findings(report["checks"])
        candidate_failed = any(item["candidate"]["status"] != "passed" for item in report["checks"])
        report["summary"] = {
            "status": "failed" if candidate_failed else "passed",
            "candidate_failed": candidate_failed,
            "baseline_failed": any(item["baseline"]["status"] != "passed" for item in report["checks"]),
            "changed_python_files": sum(path.endswith(".py") for path in changed),
            "affected_python_files": len(report["impact"].get("affected_files", [])),
            "routes_found": len(report["impact"].get("routes", [])),
        }
    except Exception as exc:
        report["summary"] = {"status": "failed", "candidate_failed": True, "baseline_failed": False, "message": redact(str(exc))}
        report["findings"] = [{
            "category": "configuration",
            "severity": "high",
            "confidence": 1.0,
            "title": "Rehearsal setup failed",
            "description": redact(str(exc)),
            "file_path": None,
            "line_start": None,
            "evidence": {},
        }]
    _write_report(report_path, report)
    return 0 if report["summary"].get("status") == "passed" else 1


def print_python_version(config_path: str) -> None:
    config = load_config(Path(config_path).resolve())
    print(f"python_version={config['python_version']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-python-version", metavar="CONFIG")
    parser.add_argument("--base")
    parser.add_argument("--candidate")
    parser.add_argument("--base-sha")
    parser.add_argument("--head-sha")
    parser.add_argument("--config")
    parser.add_argument("--run-id")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.print_python_version:
        print_python_version(args.print_python_version)
        return
    missing = [name for name in ("base", "candidate", "base_sha", "head_sha", "config", "run_id", "output") if not getattr(args, name)]
    if missing:
        parser.error(f"Missing arguments: {', '.join(missing)}")
    sys.exit(run(args))


if __name__ == "__main__":
    main()
