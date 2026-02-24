Session lessons

- write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

Changelog:
- 2026-02-24: Added conditional-shading feature; ensure INI value parsing includes splitting on common separators and updating decorations on config/document changes.

New lessons:

- When implementing feature toggles that depend on configuration, always add a dedicated configuration getter (`getConfigVariant`) and use it as the primary source of truth; only fall back to scanned data when the setting is empty.
- Keep parsing logic of user-facing tokens strict and aligned with examples; update README examples when token format changes and add unit-like tests for sample files.
- When changing parsing behavior, write a small sample file and run a packaged build to validate the exact highlighting behavior in a real VS Code instance.
- Avoid persisting transient analysis results into workspaceState unless they must survive reloads; use runtime collections for matching tests.
