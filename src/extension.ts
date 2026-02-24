import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
const ini = require('ini');

import { UdsFoldingProvider } from './foldingProvider';
import { debug } from 'console';

export function activate(context: vscode.ExtensionContext) {
    console.debug('Activating UDS Template extension…');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    let statiscompletionItems: vscode.CompletionItem[] = [];
    let iniValuesSet: Set<string> = new Set();
    let inactiveDecoration = vscode.window.createTextEditorDecorationType({
        opacity: '0.55',
        color: '#808080'
    });

    function getConfigFolders(): string[] {
        const cfg = vscode.workspace.getConfiguration('uds-template');
        const folders = cfg.get<string[]>('templatesFolder') || ['TEMPLATES'];
        return folders;
    }

    async function setConfigFolders(folders: string[]) {
        const cfg = vscode.workspace.getConfiguration('uds-template');
        await cfg.update('templatesFolder', folders, vscode.ConfigurationTarget.Workspace);
    }

    function getConfigSections(): string[] {
        const cfg = vscode.workspace.getConfiguration('uds-template');
        const sections = cfg.get<string[]>('iniSections') || ['common'];
        return sections.map(s => s.toLowerCase());
    }

    function getConfigVariant(): string | undefined {
        const cfg = vscode.workspace.getConfiguration('uds-template');
        const v = cfg.get<string>('variant');
        if (v && v.trim().length > 0) return v.trim();
        return undefined;
    }

    function collectIniFilesRecursive(folderPath: string, out: string[]) {
        try {
            if (!fs.existsSync(folderPath)) return;
            const entries = fs.readdirSync(folderPath, { withFileTypes: true });
            for (const e of entries) {
                const full = path.join(folderPath, e.name);
                if (e.isDirectory()) {
                    collectIniFilesRecursive(full, out);
                } else if (e.isFile()) {
                    const lower = e.name.toLowerCase();
                    if (lower.endsWith('.ini') && lower !== 'config.ini') {
                        out.push(full);
                    }
                }
            }
        } catch (err) {
            console.warn(`Cannot read folder ${folderPath}:`, err);
        }
    }

    function loadIniKeywords() {
        statiscompletionItems = [];
        iniValuesSet = new Set();
        const folders = getConfigFolders();
        const sections = getConfigSections();

        const allIniFiles: string[] = [];
        for (const folderEntry of folders) {
            const resolved = path.isAbsolute(folderEntry) ? folderEntry : path.join(workspaceRoot, folderEntry);
            collectIniFilesRecursive(resolved, allIniFiles);
        }

        for (const iniPath of allIniFiles) {
            try {
                const content = fs.readFileSync(iniPath, 'utf-8');
                const parsed = ini.parse(content);
                const file = path.basename(iniPath);
                for (const section in parsed) {
                    const secLower = section.toLowerCase();
                    if (!sections.includes(secLower)) continue;
                    const keys = parsed[section];
                    if (typeof keys === 'object' && keys !== null) {
                        for (const key in keys) {
                            const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Keyword);
                            item.detail = `[${section}] (${file})`;
                            item.documentation = `${key} = ${keys[key]}`;
                            statiscompletionItems.push(item);
                            // collect values as potential variants (split common separators)
                            try {
                                const raw = String(keys[key]);
                                raw.split(/[;,\s]+/).map(s => s.trim()).filter(Boolean).forEach(v => iniValuesSet.add(v.toLowerCase()));
                            } catch (err) {
                                // ignore
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Failed to parse INI ${iniPath}:`, e);
            }
        }

        console.log(`Loaded ${statiscompletionItems.length} completion items from INI files: ${allIniFiles.join(', ')}`);
        context.workspaceState.update('iniKeywords', statiscompletionItems.map(i => ({ label: i.label, detail: i.detail })));
    }

    // initial load
    loadIniKeywords();

    // react to settings change
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(ev => {
        if (ev.affectsConfiguration('uds-template.templatesFolders') ||
            ev.affectsConfiguration('uds-template.iniSections')) {
            loadIniKeywords();
            vscode.window.showInformationMessage(`uds-template: INI keywords reloaded (${statiscompletionItems.length})`);
        }
    }));

    // --- Conditional shading logic ---
    function isVariantPresent(variant: string) {
        if (!variant) return false;
        return iniValuesSet.has(variant.toLowerCase());
    }

    function parseVariantFromCondition(line: string): string | undefined {
        // Only consider conditions that reference the special token @(__VARIANT__)
        // Example: @IF ('@(__VARIANT__)' == 'PT64')
        if (!/@\(__VARIANT__\)/.test(line)) return undefined;
        // capture the RHS of equality e.g. == 'PT64' or == "PT64"
        const m = line.match(/==\s*['"]([^'"]+)['"]/);
        if (m) return m[1];
        return undefined;
    }

    function updateConditionalDecorations(editor?: vscode.TextEditor) {
        try {
            const activeEditor = editor || vscode.window.activeTextEditor;
            if (!activeEditor) return;
            if (activeEditor.document.languageId !== 'uds-template') return;

            const doc = activeEditor.document;
            const rangesToShade: vscode.Range[] = [];

            const regexIf = /^\s*@if\b/i;
            const regexElif = /^\s*@elif\b/i;
            const regexElse = /^\s*@else\b/i;
            const regexEndif = /^\s*@endif\b/i;

            // Collect a chain of branches starting at @if and ending at @endif
            let chain: { startLine: number; type: string; isTrue: boolean; endLine?: number }[] | null = null;

            for (let i = 0; i < doc.lineCount; i++) {
                const line = doc.lineAt(i).text;

                if (regexIf.test(line)) {
                    // start new chain
                    const variant = parseVariantFromCondition(line);
                    const cfgVariant = getConfigVariant();
                    const isTrue: boolean = variant ? (cfgVariant ? (variant.toLowerCase() === cfgVariant.toLowerCase()) : isVariantPresent(variant)) : false;
                    chain = [{ startLine: i, type: 'if', isTrue }];
                } else if ((regexElif.test(line) || regexElse.test(line)) && chain) {
                    // close previous branch body
                    const prev = chain[chain.length - 1];
                    prev.endLine = i - 1;
                    if (regexElif.test(line)) {
                        const variant = parseVariantFromCondition(line);
                        const cfgVariant = getConfigVariant();
                        const isTrue: boolean = variant ? (cfgVariant ? (variant.toLowerCase() === cfgVariant.toLowerCase()) : isVariantPresent(variant)) : false;
                        chain.push({ startLine: i, type: 'elif', isTrue });
                    } else {
                        // else has no condition; we'll mark true only if no earlier true
                        chain.push({ startLine: i, type: 'else', isTrue: false });
                    }
                } else if (regexEndif.test(line) && chain) {
                    // close last branch
                    const prev = chain[chain.length - 1];
                    prev.endLine = i - 1;

                    // decide active branch: first branch with isTrue === true; if none, last 'else' (if present)
                    let activeIndex = chain.findIndex(b => b.isTrue);
                    if (activeIndex === -1) {
                        for (let j = 0; j < chain.length; j++) if (chain[j].type === 'else') activeIndex = j;
                    }

                    // shade non-active branch bodies
                    for (let j = 0; j < chain.length; j++) {
                        const b = chain[j];
                        if (typeof b.endLine === 'number' && b.endLine >= b.startLine + 1) {
                            const bodyStart = b.startLine + 1;
                            const bodyEnd = b.endLine;
                            const isActive = (activeIndex === j);
                            if (!isActive) {
                                rangesToShade.push(new vscode.Range(bodyStart, 0, bodyEnd, doc.lineAt(bodyEnd).text.length));
                            }
                        }
                    }

                    // reset chain
                    chain = null;
                }
            }

            activeEditor.setDecorations(inactiveDecoration, rangesToShade);
        } catch (err) {
            console.error('Failed to update conditional decorations:', err);
        }
    }

    function chainHasTrueBefore(chain: { start: number; type: string; isTrue: boolean }[]) {
        if (chain.length <= 1) return false;
        for (let i = 0; i < chain.length - 1; i++) if (chain[i].isTrue) return true;
        return false;
    }

    // update decorations on editor change / document edit / ini reload
    vscode.window.onDidChangeActiveTextEditor(editor => updateConditionalDecorations(editor), null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(e => {
        if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
            updateConditionalDecorations(vscode.window.activeTextEditor);
        }
    }, null, context.subscriptions);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(ev => {
        if (ev.affectsConfiguration('uds-template.templatesFolder') || ev.affectsConfiguration('uds-template.iniSections')) {
            updateConditionalDecorations();
        }
    }));

    // also update once after initial load
    setTimeout(() => updateConditionalDecorations(), 250);

    // optional command to force reload
    context.subscriptions.push(vscode.commands.registerCommand('uds-template.reloadIniKeywords', async () => {
        loadIniKeywords();
        vscode.window.showInformationMessage(`uds-template: INI keywords reloaded (${statiscompletionItems.length})`);
    }));

    const provider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'uds-template' },
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                const lineText = document.lineAt(position).text;
                const completionItems: vscode.CompletionItem[] = [...statiscompletionItems];

                // CANape keywords
                const keywords = ['!sleep', '!prog', '!echo', '!dialog', '!baud', '!sa', '!repair', '!testerp', '!canid', '!pcheck', '!yield', '!suppress', '!set', '!batch', '!append', '!exit', '!auth', '!baud'];
                for (const keyword of keywords) {
                    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Function);
                    item.detail = 'CANape Script command';
                    item.insertText = keyword;
                    completionItems.push(item);
                }

                if (lineText.includes('!set(')) {
                    const setKey = [
                        {label: 'MOBIDIG', detail: 'uchar / {0,1}', doc: 'Set Mobidig-like scripting mode where Mobidig scripting is supported.'},
                        {label: 'OEM_VARIANT', detail: 'string / project specific values', doc: 'Setting of current OEM variant.'},
                        {label: 'CANCEL', detail: 'uchar / {0,1,2,3}', doc: 'Setting of cancel value which is set when diagnostic error occurs (in communication).'},
                        {label: 'CAN_BUF_SIZE', detail: 'ulong / {2..4095}', doc: 'Setting programming buffer size – length of Transfer data message in fact.'},
                        {label: 'DEVICE', detail: 'string / {“UDS”, “KWP”, “OEM”}', doc: 'Setting of current_device. There could be more devices supported but those mentioned in range are most common.'},
                        {label: 'ZF_VARIANT', detail: 'string / project specific values', doc: 'Setting of current ZF variant.'},
                        {label: 'BATCH_WAIT', detail: 'uchar /  {0,1}', doc: 'Setting an option the wait until a batch command finishes – 1, or continue in diag script when batch cmd is started – 0.'},
                        {label: 'CMD_LOG', detail: 'uchar / {0,1}', doc: 'Setting the logging option for commands.'},
                        {label: 'PROG_LOG', detail: 'uchar / {0,1}', doc: 'Setting logging option for Transfer data service in prog command.'},
                        {label: 'QUIT_ON_YIELD', detail: 'uchar / {0,1}', doc: 'Setting of tester behavior when yield() function. 1 means that the tester wakes the script immediately and continues with respect to cancel var value.'}
                    ];
                    for (const key of setKey) {
                        const item = new vscode.CompletionItem(key.label, vscode.CompletionItemKind.Value);
                        item.detail = key.detail;
                        item.documentation = new vscode.MarkdownString(key.doc);
                        item.insertText = key.label;
                        completionItems.push(item);
                    }
                }

                if (lineText.includes('!batch(')) {
                    const trace32Commands = [ /* same array as before */ 
                      { label: 'SYS.UP', detail: 'System command', doc: 'Starts up the Trace32 system.' },
                      { label: 'FLASH.AUTO', detail: 'Flash command', doc: 'Automatically programs flash memory.' },
                      { label: 'ALL', detail: 'General command', doc: 'Applies the command to all applicable targets.' },
                      { label: 'FLASH.REPROGRAM', detail: 'Flash command', doc: 'Reprograms the flash memory.' },
                      { label: 'OFF', detail: 'Control command', doc: 'Turns off a feature or module.' },
                      { label: 'ON', detail: 'Control command', doc: 'Turns on a feature or module.' },
                      { label: 'DATA.SAVE.INTELHEX', detail: 'Data command', doc: 'Saves data in Intel HEX format.' },
                      { label: 'D.S', detail: 'Display command', doc: 'Displays memory contents.' },
                      { label: 'GO', detail: 'Execution command', doc: 'Starts program execution.' },
                      { label: 'DATA.LOAD.AUTO', detail: 'Data command', doc: 'Automatically loads data.' },
                      { label: 'BREAK', detail: 'Breakpoint command', doc: 'Sets a breakpoint.' },
                      { label: 'BREAK.DELETE', detail: 'Breakpoint command', doc: 'Deletes a breakpoint.' },
                      { label: 'BREAK.SET', detail: 'Breakpoint command', doc: 'Sets a new breakpoint.' },
                      { label: 'SYS.OPTION.WDTSUS', detail: 'System option', doc: 'Controls watchdog suspend behavior.' },
                      { label: 'RUNTIME', detail: 'Runtime command', doc: 'Displays runtime information.' },
                      { label: 'RUNTIME.RESET', detail: 'Runtime command', doc: 'Resets runtime counters.' },
                      { label: 'SYS.OPTION.RESETBEHAVIOR', detail: 'System option', doc: 'Configures reset behavior.' },
                      { label: 'RESTOREGO', detail: 'Execution command', doc: 'Restores and continues execution.' },
                      { label: 'HALT', detail: 'Execution command', doc: 'Halts program execution.' },
                      { label: '/TYPE4', detail: 'Option', doc: 'Specifies type 4 format or behavior.' },
                      { label: 'DO', detail: 'Script command', doc: 'Executes a PRACTICE script.' },
                      { label: '%%LE', detail: 'Macro', doc: 'Little-endian macro definition.' },
                      { label: '%%BE', detail: 'Macro', doc: 'Little-endian macro definition.' },
                      { label: '%%LONG', detail: 'Macro', doc: 'Defines a 32-bit value.' },
                      { label: '%%WORD', detail: 'Macro', doc: 'Defines a 16-bit value.' },
                      { label: '%%BYTE', detail: 'Macro', doc: 'Defines an 8-bit value.' },
                      { label: 'FLASH.ERASE', detail: 'Flash command', doc: 'Erases flash memory.' },
                      { label: 'DISABLE', detail: 'Control command', doc: 'Disables a feature or module.' },
                      { label: 'BREAK.DISABLE', detail: 'Breakpoint command', doc: 'Disables a breakpoint.' },
                      { label: 'BREAK.ENABLE', detail: 'Breakpoint command', doc: 'Enables a breakpoint.' },
                      { label: 'DEL', detail: 'General command', doc: 'Deletes an object or setting.' },
                      { label: 'DATA.LOAD.ELF', detail: 'Data command', doc: 'Loads an ELF file.' },
                      { label: '/NOCODE', detail: 'Option', doc: 'Skips code sections.' },
                      { label: '/PROGRAM', detail: 'Option', doc: 'Targets program memory.' },
                      { label: '/ONCHIP', detail: 'Option', doc: 'Targets on-chip memory.' },
                      { label: '/COUNT', detail: 'Option', doc: 'Specifies a count or repetition.' },
                      { label: '/READWRITE', detail: 'Option', doc: 'Specifies read/write access.' },
                      { label: 'SYSTEM.UP', detail: 'System command', doc: 'Starts the system.' },
                      { label: 'SYSTEM.OPTION.WDTSUS', detail: 'System option', doc: 'Watchdog suspend option.' },
                      { label: 'SYS.OPTION.RESETMODE', detail: 'System option', doc: 'Sets the reset mode.' },
                      { label: 'SYS', detail: 'System command', doc: 'General system command prefix.' },
                      { label: 'PORST', detail: 'Reset command', doc: 'Performs a power-on reset.' },
                      { label: 'EPORST', detail: 'Reset command', doc: 'Performs an extended power-on reset.' },
                      { label: 'APP', detail: 'Application command', doc: 'Launches or configures an application.' },
                      { label: 'SYS.MODE', detail: 'System command', doc: 'Sets or displays system mode.' },
                      { label: 'NODEBUG', detail: 'Debug option', doc: 'Disables debugging.' }
                    ];

                    for (const cmd of trace32Commands) {
                        const item = new vscode.CompletionItem(cmd.label, vscode.CompletionItemKind.Function);
                        item.detail = cmd.detail;
                        item.documentation = new vscode.MarkdownString(cmd.doc);
                        item.insertText = cmd.label;
                        completionItems.push(item);
                    }
                }

                if (lineText.startsWith('@')) {
                    const setKey = [
                        {label: 'if', detail: '', doc: 'Start of statement'},
                        {label: 'elif', detail: '', doc: ''},
                        {label: 'else', detail: '', doc: ''},
                        {label: 'endif', detail: '', doc: 'End of statement'}
                        {label: 'error', detail: '', doc: 'ERROR + comment'}
                    ];
                    for (const key of setKey) {
                        const item = new vscode.CompletionItem(key.label, vscode.CompletionItemKind.Keyword);
                        item.detail = key.detail;
                        item.documentation = new vscode.MarkdownString(key.doc);
                        item.insertText = key.label;
                        completionItems.push(item);
                    }
                }
                return completionItems;
            }
        }
    );
    context.subscriptions.push(provider);


    const foldingProvider = vscode.languages.registerFoldingRangeProvider(
        { scheme: 'file', language: 'uds-template' },
        new UdsFoldingProvider()
        
    );
    context.subscriptions.push(foldingProvider);
}

export function deactivate() {}
