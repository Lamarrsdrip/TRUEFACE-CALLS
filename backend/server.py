from fastapi import FastAPI

app = FastAPI(
    title="TrueFace Calls API",
    version="0.2.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "runtime": "emergent-native",
        "database": "not-connected",
    }
