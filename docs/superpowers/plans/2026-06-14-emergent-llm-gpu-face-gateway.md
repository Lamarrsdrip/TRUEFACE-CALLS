# Emergent LLM and GPU Face Gateway Implementation Plan

1. Add provider-policy and environment fallback coverage for the requested
   Emergent LLM and GPU variables.
2. Add failing API tests for provider health, local fallback, authorization,
   frame validation, successful normalized inference, and redacted failures.
3. Implement an optional Emergent LLM orchestration client and a normalized GPU
   inference client.
4. Add `/api/ai/face/provider-health` and
   `/api/ai/face/process-frame` with room/profile authorization and bounded
   in-memory frame handling.
5. Change face activation and system readiness to use GPU health for cloud
   processing, while keeping Emergent LLM diagnostics separate.
6. Add a browser cloud-frame session that publishes only its processed canvas
   track and falls back to local mode when cloud is unavailable.
7. Clarify Admin Provider labels, helper text, status, and environment examples.
8. Update production and audit documentation.
9. Run backend tests, frontend tests, typecheck, production build, and security
   audit.
10. Commit and mirror the verified commit to every branch Emergent has used.
