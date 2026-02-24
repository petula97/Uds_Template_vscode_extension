# Change Log

+ V0.2.0 (08-10-2025)
+ add folding support for all section (if, elif, else, endif)
+ fixed case sensitivity

+ V0.1.5 (08-10-2025)
  + add setings for filtering specific variant from ini files
  + add support to load more then one path
    + user and workspace settings

+ UNKNOWN
  + IntelijSense for CANape and Lauterbach commands (only some comands, rest will be added later)
  + highlites fixed
  + snippets added
  

## [Unreleased]
- 2026-02-24: v0.3.0
  - Added conditional shading for `@if/@elif/@else` blocks driven by `uds-template.variant` setting or INI values.
  - Rewrote branch parsing to correctly identify active branch and shade non-active bodies.
  - Made INI variant matching case-insensitive and documented behavior in `README.md`.
  - Added `build:vsix` npm script and updated packaging workflow.
  - Updated `lessons.md` with rules to prevent regressions.
