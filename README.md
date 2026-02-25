# uds-template-keaywords README

UDS template - main idea is to have complete highlites and snippets. The best feature is loading ini files from \TEMPLATES\ folder if the workspace is setup to git repository root.

## Features

* loading all ini files except "config.ini" from configuration of the extension (workspace/user).

## Requirements

* N/A

## Extension Settings

* VARIANTS - filtering from ini
* PATHs - load ini files

## Conditional shading feature

- The extension now shades inactive `@if/@elif/@else` blocks in grey when the condition compares `@(__VARIANT__)` against a variant that is not found in the loaded INI values.
- INI values are loaded from the configured `uds-template.iniSections` and searched for simple token matches (split on `,`, `;` or whitespace).

Note about INI formatting:

- Only INI files are loaded from the configured template folders.
- When a section entry contains multiple variants, the extension will only consider the first variant token in that entry for highlighting decisions; subsequent tokens in the same field are ignored for highlighting purposes.

Example:

@IF ('@(__VARIANT__)' == 'PT64')
2101ff01 ;EXTENDED - shall be visible
@elif ('@(__VARIANT__)' == 'EST90')
2101ff01 ; shall be shaded
@else
2101ff01 ; shall be shaded
@ENDIF

If `PT64` appears among loaded INI values then the first block remains normal and the others are shaded.

Update (2026-02-25): Complex boolean expressions in `@IF`/`@ELIF` are now supported. Conditions like

```
@ELIF ('@(__VARIANT__)' == 'PT64' or '@(__VARIANT__)' == 'EC5_BL')
```

will be evaluated correctly and the matching branch will remain active while other branches are shaded.

Release 0.3.1 (2026-02-25):
- Fix: support `!=` in conditional expressions and correct evaluation of mixed `and`/`or` expressions when referencing `@(__VARIANT__)`.
- Docs: updated README and lessons with parsing details.

## Known Issues

Highlites of keywords in the UDS commands are not working properly.

## Release Notes



### 1.0.0

Initial release of - not released yet.

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://github.com/petula97/Uds_Template_vscode_extension)


**Enjoy!**
