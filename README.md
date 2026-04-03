# uds-template-keaywords README

UDS template extension for VS Code. The main idea is to provide complete highlights and snippets. The standout feature is the ability to automatically load `.ini` files from the `\TEMPLATES\` folder when the workspace is set up to a Git repository root.

---

## 🌟 Features

* Loads all `.ini` files (except `config.ini`) from the workspace or user configuration of the extension.

## 🛠️ Requirements

* N/A

## ⚙️ Extension Settings

* **VARIANTS**: Used for filtering from loaded INI files.
* **PATHs**: Defines paths to load the INI files from.

---

## 🌓 Conditional Shading Feature

The extension dynamically shades inactive `@if`, `@elif`, and `@else` blocks in grey when a condition compares `@(__VARIANT__)` against a variant that is not found in the loaded INI values.

### How INI files are processed:
* INI values are loaded from the configured `uds-template.iniSections`.
* They are searched for simple token matches (split on commas `,`, semicolons `;`, or whitespace).
* **Note about INI formatting:** Only INI files are loaded from the configured template folders. When a section entry contains multiple variants, the extension will only consider the **first** variant token in that entry for highlighting decisions; subsequent tokens in the same field are ignored.

### Example:

    @IF ('@(__VARIANT__)' == 'PT64')
        2101ff01 ;EXTENDED - shall be visible
    @elif ('@(__VARIANT__)' == 'EST90')
        2101ff01 ; shall be shaded
    @else
        2101ff01 ; shall be shaded
    @ENDIF

*If `PT64` appears among loaded INI values, the first block remains normal and the others are shaded.*

### Updates to this feature:
* **Update (2026-02-25):** Complex boolean expressions in `@IF` and `@ELIF` are now fully supported. Conditions like `@ELIF ('@(__VARIANT__)' == 'PT64' or '@(__VARIANT__)' == 'EC5_BL')` will be evaluated correctly, keeping the matching branch active while others are shaded.

---

## 🐛 Known Issues

* None

---

## 📜 Release Notes

### Release V1.0.0
* **Fix:** Resolved small bugs with evaluation and the conditional shading feature.
* **Removed:** Custom themes; reverted to default themes from VS Code.
* **Add:** Whisper for Lauterbach commands (currently with Czech translation—this will be changed to English in the future).

---

## 🤝 Following Extension Guidelines


* [Extension Guidelines](https://github.com/petula97/Uds_Template_vscode_extension)

---

**Enjoy!**