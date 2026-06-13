from fastapi.testclient import TestClient

from backend.server import app


def test_health_reports_emergent_runtime():
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "runtime": "emergent-native",
        "database": "not-connected",
    }
