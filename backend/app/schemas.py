from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: str
    severity: str
    confidence: float
    title: str
    description: str
    file_path: str | None
    line_start: int | None
    evidence: dict


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    repository_owner: str
    repository_name: str
    pull_request_number: int
    pull_request_title: str
    base_sha: str
    head_sha: str
    status: str
    workflow_url: str | None
    failure_reason: str | None
    check_results: list
    impact: dict
    created_at: datetime


class RunDetailResponse(RunResponse):
    findings: list[FindingResponse]
