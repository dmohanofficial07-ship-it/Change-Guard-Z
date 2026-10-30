"""Lightweight, evidence-linked Python import and route impact analysis."""

import ast
from collections import defaultdict, deque
from pathlib import Path

IGNORED_DIRS = {".git", ".venv", "venv", "__pycache__", "node_modules", "build", "dist", ".mypy_cache", ".pytest_cache"}
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "route"}
MAX_SOURCE_FILES = 5000
MAX_SOURCE_BYTES = 1_000_000


def _module_name(path: Path, root: Path) -> str:
    relative = path.relative_to(root)
    parts = list(relative.parts)
    filename = parts.pop()
    if filename != "__init__.py":
        parts.append(Path(filename).stem)
    return ".".join(parts)


def _relative_imports(node: ast.ImportFrom, path: Path, module: str) -> list[str]:
    if node.level == 0:
        base = node.module or ""
    else:
        module_parts = module.split(".") if module else []
        package_parts = module_parts if path.name == "__init__.py" else module_parts[:-1]
        keep = max(0, len(package_parts) - node.level + 1)
        base_parts = package_parts[:keep]
        if node.module:
            base_parts.extend(node.module.split("."))
        base = ".".join(base_parts)
    imports = [base] if base else []
    for alias in node.names:
        if alias.name != "*":
            imports.append(".".join(part for part in (base, alias.name) if part))
    return imports


def _route_definitions(tree: ast.AST, file_path: str) -> list[dict]:
    routes: list[dict] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            method = None
            if isinstance(decorator.func, ast.Attribute) and decorator.func.attr.lower() in HTTP_METHODS:
                method = decorator.func.attr.upper()
            if method is None or not decorator.args or not isinstance(decorator.args[0], ast.Constant):
                continue
            route_path = decorator.args[0].value
            if isinstance(route_path, str) and route_path.startswith(("/", "http")):
                routes.append({
                    "method": method,
                    "path": route_path[:500],
                    "function": node.name[:200],
                    "file_path": file_path,
                    "line_start": node.lineno,
                })
    return routes


def build_impact(candidate_root: Path, changed_files: list[str]) -> dict:
    root = candidate_root.resolve()
    modules: dict[str, Path] = {}
    trees: dict[Path, ast.AST] = {}
    parse_errors: list[dict[str, str | int]] = []

    source_paths = []
    for path in root.rglob("*.py"):
        if any(part in IGNORED_DIRS for part in path.parts):
            continue
        if path.is_symlink():
            continue
        try:
            relative = path.relative_to(root).as_posix()
            if path.stat().st_size > MAX_SOURCE_BYTES:
                continue
        except (OSError, ValueError):
            continue
        source_paths.append((relative, path))
        if len(source_paths) >= MAX_SOURCE_FILES:
            break

    imports_to_files: dict[str, set[str]] = defaultdict(set)
    file_to_module: dict[str, str] = {}
    for relative, path in source_paths:
        module = _module_name(path, root)
        modules[module] = path
        file_to_module[relative] = module
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=relative)
        except (SyntaxError, ValueError) as exc:
            parse_errors.append({"file_path": relative, "line_start": int(getattr(exc, "lineno", 0) or 0), "message": str(exc)[:300]})
            continue
        trees[path] = tree

    known_modules = set(modules)
    reverse_edges: dict[str, set[str]] = defaultdict(set)
    for relative, path in source_paths:
        module = file_to_module[relative]
        tree = trees.get(path)
        if tree is None:
            continue
        for node in ast.walk(tree):
            targets: list[str] = []
            if isinstance(node, ast.Import):
                targets.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                targets.extend(_relative_imports(node, path, module))
            for target in targets:
                candidates = [name for name in known_modules if target == name or target.startswith(f"{name}.")]
                if candidates:
                    resolved = max(candidates, key=len)
                    reverse_edges[resolved].add(module)

    changed_modules = {file_to_module[path] for path in changed_files if path in file_to_module}
    impacted_modules = set(changed_modules)
    frontier = deque(changed_modules)
    while frontier:
        changed = frontier.popleft()
        for importer in reverse_edges.get(changed, set()):
            if importer not in impacted_modules:
                impacted_modules.add(importer)
                frontier.append(importer)

    impacted_files = sorted(path for path, module in file_to_module.items() if module in impacted_modules)
    routes: list[dict] = []
    for relative, path in source_paths:
        if file_to_module.get(relative) not in impacted_modules:
            continue
        tree = trees.get(path)
        if tree is not None:
            routes.extend(_route_definitions(tree, relative))

    return {
        "changed_files": sorted(set(changed_files))[:500],
        "affected_files": impacted_files[:1000],
        "routes": routes[:500],
        "parse_errors": parse_errors[:100],
        "confidence": "medium",
        "method": "static Python import graph",
    }
