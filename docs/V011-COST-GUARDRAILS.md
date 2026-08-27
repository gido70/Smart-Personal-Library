# V0.11 Cost Guardrails

- Building and previewing V0.11 must not enable paid AI.
- The server-side `SPL_PAID_AI_ENABLED` secret remains the financial boundary.
- Existing analysis is reused instead of regenerated.
- Existing audio is reused instead of regenerated.
- Pilot starts with one real book before expansion.
- Questions remain limited by existing server-side caps.
- Cost logging remains per book through `spl_ai_usage`.
- Any future provider switch belongs behind the AI Gateway rather than hard-coding multiple providers into every screen.
