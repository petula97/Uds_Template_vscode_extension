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
    let iniKeysMap: Map<string,string> = new Map();
    let inactiveDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor('disabledForeground')
        // opacity: '0.55',
        // color: '#808080'
    });
    let missingVariantDecoration = vscode.window.createTextEditorDecorationType({
        // color: '#ff0000',
        color: new vscode.ThemeColor('errorForeground'),
        fontWeight: 'bold'
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
                                    // store key -> value mapping for variable lookups like @(SECBOOT)
                                    iniKeysMap.set(key.toLowerCase(), String(keys[key]));
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
        // backward-compat: return first literal variant found (not used by new evaluator)
        if (!/@\(__VARIANT__\)/.test(line)) return undefined;
        const m = line.match(/==\s*['"]([^'\"]+)['"]/);
        if (m) return m[1];
        return undefined;
    }

    function evaluateCondition(line: string, doc?: vscode.TextDocument, lineIndex?: number, missingRanges?: vscode.Range[]): { result: boolean; hasVariant: boolean } {
        // Handle expressions that reference @(__VARIANT__) or other variables @(KEY).
        const cfgVariant = getConfigVariant();

        let hasVariant = false;

        // Match comparisons like @(KEY) == 'LIT' or @(__VARIANT__) != "LIT"
            const compRegex = /[\'\"]?@\((__VARIANT__|[^)]+)\)[\'\"]?\s*(==|!=)\s*[\'\"]([^\'\"]+)[\'\"]/ig;

        let expr = line.replace(compRegex, function (match, key, op, literal, offset) {
            const keyName = String(key).trim();
            const keyLower = keyName.toLowerCase();

            // special handling for __VARIANT__ token
            if (keyLower === '__variant__') {
                hasVariant = true;
                let matchVal = cfgVariant ? (literal.toLowerCase() === cfgVariant.toLowerCase()) : isVariantPresent(literal);
                if (op === '!=') matchVal = !matchVal;
                return matchVal ? ' true ' : ' false ';
            }

            // other variables: lookup key in loaded INI keys
            if (iniKeysMap.has(keyLower)) {
                hasVariant = true;
                const val = (iniKeysMap.get(keyLower) || '').trim();
                let matchVal = val.toLowerCase() === literal.toLowerCase();
                if (op === '!=') matchVal = !matchVal;
                return matchVal ? ' true ' : ' false ';
            }

            // unknown key -> mark missing (highlight variable name) and treat comparison as false
            if (missingRanges && typeof lineIndex === 'number' && typeof offset === 'number') {
                const matchStart = offset as number;
                const idxInMatch = match.indexOf(keyName);
                const pos = idxInMatch >= 0 ? matchStart + idxInMatch : line.indexOf(keyName, matchStart);
                if (pos >= 0) {
                    missingRanges.push(new vscode.Range(lineIndex, pos, lineIndex, pos + keyName.length));
                }
            }
            return ' false ';
        });

            // Then, handle standalone truthy checks like @IF (@(ALFID)) -> true if the INI key value === '1'
            const unaryRegex = /[\'\"]?@\((__VARIANT__|[^)]+)\)[\'\"]?(?!\s*(?:==|!=))/ig;
            expr = expr.replace(unaryRegex, function (match, key, offset) {
                const keyName = String(key).trim();
                const keyLower = keyName.toLowerCase();

                if (keyLower === '__variant__') {
                    // presence of configured variant is considered truthy
                    const present = !!cfgVariant || iniValuesSet.size > 0;
                    if (present) hasVariant = true;
                    return present ? ' true ' : ' false ';
                }

                if (iniKeysMap.has(keyLower)) {
                    hasVariant = true;
                    const val = (iniKeysMap.get(keyLower) || '').trim();
                    const truthy = val === '1';
                    return truthy ? ' true ' : ' false ';
                }

                // unknown key -> mark missing
                if (missingRanges && typeof lineIndex === 'number' && typeof offset === 'number') {
                    const matchStart = offset as number;
                    const idxInMatch = match.indexOf(keyName);
                    const pos = idxInMatch >= 0 ? matchStart + idxInMatch : line.indexOf(keyName, matchStart);
                    if (pos >= 0) missingRanges.push(new vscode.Range(lineIndex, pos, lineIndex, pos + keyName.length));
                }
                return ' false ';
            });
        // Remove leading directive token like @IF, @ELIF and surrounding parentheses
        expr = expr.replace(/^\s*@(?:if|elif)\b/i, '');
        expr = expr.replace(/^\s*\(/, '');
        expr = expr.replace(/\)\s*$/, '');

        // Normalize logical operators to lowercase words
        expr = expr.replace(/\bOR\b/ig, ' or ');
        expr = expr.replace(/\bAND\b/ig, ' and ');

        // Now tokenise and evaluate a very small boolean grammar with tokens: true,false,(,),and,or
        const tokens = expr.split(/(\s+|\(|\))/).map(t => t.trim()).filter(Boolean);

        // Convert tokens to RPN using shunting-yard
        const outQueue: string[] = [];
        const opStack: string[] = [];
        const precedence: { [op: string]: number } = { 'or': 1, 'and': 2 };

        for (const tok of tokens) {
            const lower = tok.toLowerCase();
            if (lower === 'true' || lower === 'false') {
                outQueue.push(lower);
            } else if (lower === 'and' || lower === 'or') {
                while (opStack.length > 0) {
                    const top = opStack[opStack.length - 1];
                    if ((top === 'and' || top === 'or') && precedence[top] >= precedence[lower]) {
                        outQueue.push(opStack.pop() as string);
                        continue;
                    }
                    break;
                }
                opStack.push(lower);
            } else if (tok === '(') {
                opStack.push(tok);
            } else if (tok === ')') {
                while (opStack.length > 0 && opStack[opStack.length - 1] !== '(') {
                    outQueue.push(opStack.pop() as string);
                }
                if (opStack.length > 0 && opStack[opStack.length - 1] === '(') opStack.pop();
            } else {
                // ignore unknown tokens (e.g. comments) conservatively
            }
        }
        while (opStack.length > 0) outQueue.push(opStack.pop() as string);

        // Evaluate RPN
        const evalStack: boolean[] = [];
        for (const t of outQueue) {
            if (t === 'true' || t === 'false') {
                evalStack.push(t === 'true');
            } else if (t === 'and' || t === 'or') {
                const b = evalStack.pop();
                const a = evalStack.pop();
                if (typeof a === 'undefined' || typeof b === 'undefined') return { result: false, hasVariant };
                evalStack.push(t === 'and' ? (a && b) : (a || b));
            }
        }
        return { result: evalStack.length === 1 ? evalStack[0] : false, hasVariant };
    }

    function updateConditionalDecorations(editor?: vscode.TextEditor) {
        try {
            const activeEditor = editor || vscode.window.activeTextEditor;
            if (!activeEditor) return;
            if (activeEditor.document.languageId !== 'uds-template') return;

            const doc = activeEditor.document;
            const rangesToShade: vscode.Range[] = [];
            const missingVariantRanges: vscode.Range[] = [];

            const regexIf    = /^\s*@if\b/i;
            const regexElif  = /^\s*@elif\b/i;
            const regexElse  = /^\s*@else\b/i;
            const regexEndif = /^\s*@endif\b/i;

            type Branch = {
                startLine: number;
                type: 'if' | 'elif' | 'else';
                isTrue: boolean;
                endLine?: number;
            };

            // Zásobník pro vnořené bloky
            const chainStack: Branch[][] = [];
            const chainVariantStack: boolean[] = [];

            for (let i = 0; i < doc.lineCount; i++) {
                const line = doc.lineAt(i).text;

                if (regexIf.test(line)) {
                    // Začátek nového (případně vnořeného) bloku
                    const evalRes = evaluateCondition(line, doc, i, missingVariantRanges);
                    chainStack.push([{ startLine: i, type: 'if', isTrue: evalRes.result }]);
                    chainVariantStack.push(evalRes.hasVariant);

                } else if ((regexElif.test(line) || regexElse.test(line)) && chainStack.length > 0) {
                    const chain = chainStack[chainStack.length - 1];
                    // Uzavřít tělo předchozí větve
                    chain[chain.length - 1].endLine = i - 1;

                    if (regexElif.test(line)) {
                        const evalRes = evaluateCondition(line, doc, i, missingVariantRanges);
                        chain.push({ startLine: i, type: 'elif', isTrue: evalRes.result });
                        chainVariantStack[chainVariantStack.length - 1] =
                            chainVariantStack[chainVariantStack.length - 1] || evalRes.hasVariant;
                    } else {
                        // else je aktivní jen pokud žádná předchozí větev není true
                        const hasTrueSoFar = chain.some(b => b.isTrue);
                        chain.push({ startLine: i, type: 'else', isTrue: !hasTrueSoFar });
                    }

                } else if (regexEndif.test(line) && chainStack.length > 0) {
                    const chain = chainStack.pop()!;
                    const chainHasVariant = chainVariantStack.pop()!;

                    // Uzavřít poslední větev
                    chain[chain.length - 1].endLine = i - 1;

                    // Aktivní větev: první true, nebo else
                    const activeIndex = chain.findIndex(b => b.isTrue);

                    if (chainHasVariant) {
                        for (let j = 0; j < chain.length; j++) {
                            const b = chain[j];
                            if (typeof b.endLine === 'number' && b.endLine >= b.startLine + 1) {
                                const isActive = (activeIndex === j);
                                if (!isActive) {
                                    rangesToShade.push(new vscode.Range(
                                        b.startLine + 1, 0,
                                        b.endLine,
                                        doc.lineAt(b.endLine).text.length
                                    ));
                                }
                            }
                        }
                    }
                }
            }

            activeEditor.setDecorations(inactiveDecoration, rangesToShade);
            activeEditor.setDecorations(missingVariantDecoration, missingVariantRanges);

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
                const keywords = ['!sleep', '!prog', '!echo', '!dialog', '!baud', '!sa', '!repair', '!testerp', '!canid', '!pcheck', '!yield', '!suppress', '!set', '!batch', '!append', '!exit', '!auth', '!baud', '!send'];
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
                    const trace32Commands = [
                        // ── SYStem ──────────────────────────────────────────────
                        { label: 'SYStem.Up',                   detail: 'System',       doc: 'Připojí debugger k cíli a resetuje ho.' },
                        { label: 'SYStem.Down',                  detail: 'System',       doc: 'Odpojí debugger od cíle.' },
                        { label: 'SYStem.Mode',                  detail: 'System',       doc: 'Nastaví režim připojení (Go, Attach, Nodebug...).' },
                        { label: 'SYStem.Mode.Go',               detail: 'System',       doc: 'Připojí debugger a nechá CPU běžet.' },
                        { label: 'SYStem.Mode.Attach',           detail: 'System',       doc: 'Připojí se k běžícímu CPU bez resetu.' },
                        { label: 'SYStem.Mode.Nodebug',          detail: 'System',       doc: 'Odpojí debugger, CPU běží volně.' },
                        { label: 'SYStem.CPU',                   detail: 'System',       doc: 'Nastaví typ procesoru (např. SYStem.CPU TC387).' },
                        { label: 'SYStem.CONFIG.Slave',          detail: 'System',       doc: 'Nakonfiguruje slave debug port.' },
                        { label: 'SYStem.Option.WaitReset',      detail: 'System/Opt',   doc: 'Čeká na dokončení resetu před připojením.' },
                        { label: 'SYStem.Option.DUALPORT',       detail: 'System/Opt',   doc: 'Povolí dual-port přístup do paměti.' },
                        { label: 'SYStem.Option.ResBreak',       detail: 'System/Opt',   doc: 'Zastaví CPU ihned po resetu.' },
                        { label: 'SYStem.Option.EnReset',        detail: 'System/Opt',   doc: 'Povolí hardwarový reset přes debugger.' },
                        { label: 'SYStem.Option.WDTSUS',       detail: 'System/Opt',   doc: 'Nastaví chování watchdogu během debugování.' },
                        { label: 'SYStem.Option.HSMRESTART',       detail: 'System/HSM',   doc: 'Nastaví SPUŠTĚNÍ HSM TLAČÍTKEM START.' },
                        { label: 'SYStem.JtagClock',             detail: 'System',       doc: 'Nastaví frekvenci JTAG/SWD hodin.' },
                        { label: 'SYStem.ResetTarget',           detail: 'System',       doc: 'Provede reset cíle.' },

                        // ── FLASH ───────────────────────────────────────────────
                        { label: 'FLASH.Reset',                  detail: 'Flash',        doc: 'Resetuje flash driver, smaže všechny definice.' },
                        { label: 'FLASH.Create',                 detail: 'Flash',        doc: 'Definuje flash region (adresa, velikost, typ).' },
                        { label: 'FLASH.Target',                 detail: 'Flash',        doc: 'Nahraje flash algoritmus do RAM cíle.' },
                        { label: 'FLASH.Auto',                   detail: 'Flash',        doc: 'Automaticky naprogramuje flash ze souboru.' },
                        { label: 'FLASH.Program',                detail: 'Flash',        doc: 'Naprogramuje flash ze zadané oblasti paměti.' },
                        { label: 'FLASH.Erase',                  detail: 'Flash',        doc: 'Smaže celou flash nebo zadaný sektor.' },
                        { label: 'FLASH.Erase.ALL',              detail: 'Flash',        doc: 'Smaže celou flash paměť.' },
                        { label: 'FLASH.Erase.Sector',           detail: 'Flash',        doc: 'Smaže zadaný flash sektor.' },
                        { label: 'FLASH.ReProgram',              detail: 'Flash',        doc: 'Přeprogramuje flash (erase + program).' },
                        { label: 'FLASH.ReProgram.ALL',          detail: 'Flash',        doc: 'Přeprogramuje celou flash.' },
                        { label: 'FLASH.Write',                  detail: 'Flash',        doc: 'Zapíše data do flash bez mazání.' },
                        { label: 'FLASH.List',                   detail: 'Flash',        doc: 'Zobrazí seznam definovaných flash regionů.' },
                        { label: 'FLASH.CLocK',                  detail: 'Flash',        doc: 'Nastaví hodinový zdroj pro flash operace.' },

                        // ── Data / paměť ─────────────────────────────────────────
                        { label: 'Data.Load.Auto',               detail: 'Data',         doc: 'Automaticky načte soubor (ELF/HEX/BIN) do paměti.' },
                        { label: 'Data.Load.Elf',                detail: 'Data',         doc: 'Načte ELF soubor do paměti.' },
                        { label: 'Data.Load.IntelHex',           detail: 'Data',         doc: 'Načte Intel HEX soubor do paměti.' },
                        { label: 'Data.Load.Binary',             detail: 'Data',         doc: 'Načte binární soubor na zadanou adresu.' },
                        { label: 'Data.Load.S3Record',           detail: 'Data',         doc: 'Načte Motorola S-record soubor.' },
                        { label: 'Data.Save.IntelHex',           detail: 'Data',         doc: 'Uloží oblast paměti jako Intel HEX soubor.' },
                        { label: 'Data.Save.Binary',             detail: 'Data',         doc: 'Uloží oblast paměti jako binární soubor.' },
                        { label: 'Data.Save.S3Record',           detail: 'Data',         doc: 'Uloží oblast paměti jako S-record soubor.' },
                        { label: 'Data.Set',                     detail: 'Data',         doc: 'Zapíše hodnotu na zadanou adresu.' },
                        { label: 'Data.Set.Byte',                detail: 'Data',         doc: 'Zapíše byte na zadanou adresu.' },
                        { label: 'Data.Set.Word',                detail: 'Data',         doc: 'Zapíše 16-bit word na zadanou adresu.' },
                        { label: 'Data.Set.Long',                detail: 'Data',         doc: 'Zapíše 32-bit long na zadanou adresu.' },
                        { label: 'Data.Set.Quad',                detail: 'Data',         doc: 'Zapíše 64-bit quad na zadanou adresu.' },
                        { label: 'Data.Copy',                    detail: 'Data',         doc: 'Kopíruje blok paměti.' },
                        { label: 'Data.Fill',                    detail: 'Data',         doc: 'Vyplní oblast paměti zadanou hodnotou.' },
                        { label: 'Data.Pattern',                 detail: 'Data',         doc: 'Vyplní paměť vzorem.' },
                        { label: 'Data.Compare',                 detail: 'Data',         doc: 'Porovná dva bloky paměti.' },
                        { label: 'Data.dump',                    detail: 'Data',         doc: 'Zobrazí hexdump oblasti paměti.' },
                        { label: 'Data.List',                    detail: 'Data',         doc: 'Zobrazí disassembly oblasti paměti.' },

                        // ── Break / breakpointy ───────────────────────────────────
                        { label: 'Break',                        detail: 'Break',        doc: 'Zastaví CPU.' },
                        { label: 'Break.Set',                    detail: 'Break',        doc: 'Nastaví breakpoint na adresu nebo symbol.' },
                        { label: 'Break.Set.Program',            detail: 'Break',        doc: 'Nastaví programový breakpoint.' },
                        { label: 'Break.Set.Read',               detail: 'Break',        doc: 'Nastaví read watchpoint.' },
                        { label: 'Break.Set.Write',              detail: 'Break',        doc: 'Nastaví write watchpoint.' },
                        { label: 'Break.Set.ReadWrite',          detail: 'Break',        doc: 'Nastaví read/write watchpoint.' },
                        { label: 'Break.Delete',                 detail: 'Break',        doc: 'Smaže zadaný breakpoint.' },
                        { label: 'Break.Delete.ALL',             detail: 'Break',        doc: 'Smaže všechny breakpointy.' },
                        { label: 'Break.Enable',                 detail: 'Break',        doc: 'Povolí zadaný breakpoint.' },
                        { label: 'Break.Disable',                detail: 'Break',        doc: 'Zakáže zadaný breakpoint.' },
                        { label: 'Break.List',                   detail: 'Break',        doc: 'Zobrazí seznam breakpointů.' },

                        // ── Řízení běhu ───────────────────────────────────────────
                        { label: 'Go',                           detail: 'Run',          doc: 'Spustí CPU.' },
                        { label: 'Go.direct',                    detail: 'Run',          doc: 'Spustí CPU bez nastavení breakpointů.' },
                        { label: 'Go.Return',                    detail: 'Run',          doc: 'Běží do návratu z funkce (step out).' },
                        { label: 'Go.Up',                        detail: 'Run',          doc: 'Běží do konce aktuálního bloku.' },
                        { label: 'Step',                         detail: 'Run',          doc: 'Provede jeden krok (step into).' },
                        { label: 'Step.Over',                    detail: 'Run',          doc: 'Provede krok přes funkci (step over).' },
                        { label: 'Step.Out',                     detail: 'Run',          doc: 'Dokončí aktuální funkci (step out).' },
                        { label: 'HALT',                         detail: 'Run',          doc: 'Zastaví CPU.' },
                        { label: 'WAIT',                         detail: 'Run',          doc: 'Čeká na podmínku nebo časový limit.' },
                        { label: 'WAIT.time',                    detail: 'Run',          doc: 'Čeká zadaný čas (např. WAIT.time 500ms).' },

                        // ── Register ──────────────────────────────────────────────
                        { label: 'Register.Set',                 detail: 'Register',     doc: 'Nastaví hodnotu registru.' },
                        { label: 'Register.Get',                 detail: 'Register',     doc: 'Čte hodnotu registru.' },
                        { label: 'Register.List',                detail: 'Register',     doc: 'Zobrazí seznam registrů.' },
                        { label: 'Register.dump',                detail: 'Register',     doc: 'Zobrazí obsah registrů.' },

                        // ── sYmbol / ELF ──────────────────────────────────────────
                        { label: 'sYmbol.Browse',                detail: 'Symbol',       doc: 'Otevře prohlížeč symbolů.' },
                        { label: 'sYmbol.List',                  detail: 'Symbol',       doc: 'Vypíše seznam symbolů.' },
                        { label: 'sYmbol.SourcePATH',            detail: 'Symbol',       doc: 'Nastaví cestu ke zdrojovým souborům.' },
                        { label: 'sYmbol.AutoLoad',              detail: 'Symbol',       doc: 'Automaticky načte symboly z ELF.' },

                        // ── Var ───────────────────────────────────────────────────
                        { label: 'Var.Set',                      detail: 'Var',          doc: 'Nastaví hodnotu proměnné/symbolu.' },
                        { label: 'Var.Get',                      detail: 'Var',          doc: 'Čte hodnotu proměnné.' },
                        { label: 'Var.dump',                     detail: 'Var',          doc: 'Zobrazí hodnoty proměnných.' },
                        { label: 'Var.Watch',                    detail: 'Var',          doc: 'Přidá proměnnou do watch window.' },

                        // ── PRACTICE skript ───────────────────────────────────────
                        { label: 'DO',                           detail: 'Script',       doc: 'Spustí PRACTICE skript (.cmm).' },
                        { label: 'ENDDO',                        detail: 'Script',       doc: 'Ukončí PRACTICE skript.' },
                        { label: 'ENTRY',                        detail: 'Script',       doc: 'Definuje vstupní parametry skriptu.' },
                        { label: 'RETURN',                       detail: 'Script',       doc: 'Vrátí hodnotu ze skriptu nebo funkce.' },
                        { label: 'GOSUB',                        detail: 'Script',       doc: 'Skočí na subruotinu v PRACTICE skriptu.' },
                        { label: 'PRINT',                        detail: 'Script',       doc: 'Vypíše text do AREA okna.' },
                        { label: 'AREA.OPEN',                    detail: 'Script',       doc: 'Otevře nebo vytvoří AREA okno.' },
                        { label: 'AREA.CLEAR',                   detail: 'Script',       doc: 'Smaže obsah AREA okna.' },

                        // ── Periférie / runtime ───────────────────────────────────
                        { label: 'RUNTIME',                      detail: 'Runtime',      doc: 'Zobrazí runtime statistiky.' },
                        { label: 'RUNTIME.RESET',                detail: 'Runtime',      doc: 'Resetuje runtime čítače.' },
                        { label: 'PER.Set',                      detail: 'Peripheral',   doc: 'Nastaví hodnotu periferie (SFR).' },
                        { label: 'PER.Get',                      detail: 'Peripheral',   doc: 'Čte hodnotu periferie (SFR).' },
                        { label: 'PER.dump',                     detail: 'Peripheral',   doc: 'Zobrazí hodnoty periferií.' },

                        // ── Reset ─────────────────────────────────────────────────
                        { label: 'SYStem.ResetTarget',           detail: 'Reset',        doc: 'Resetuje cíl přes debugger.' },
                        { label: 'PORST',                        detail: 'Reset',        doc: 'Power-On reset.' },
                        { label: 'EPORST',                       detail: 'Reset',        doc: 'Extended power-on reset (Infineon).' },

                        // ── Modifikátory / volby ──────────────────────────────────
                        { label: '/VERIFY',                      detail: 'Option',       doc: 'Po naprogramování ověří obsah flash.' },
                        { label: '/NOCODE',                      detail: 'Option',       doc: 'Ignoruje code sekce při načítání ELF.' },
                        { label: '/PROGRAM',                     detail: 'Option',       doc: 'Cílí na program paměť.' },
                        { label: '/ONCHIP',                      detail: 'Option',       doc: 'Cílí na on-chip paměť.' },
                        { label: '/KEEP',                        detail: 'Option',       doc: 'Zachová stávající obsah (nemazat před zápisem).' },
                        { label: '/NORESET',                     detail: 'Option',       doc: 'Neprovádí reset při operaci.' },
                        { label: '/READWRITE',                   detail: 'Option',       doc: 'Označí paměť jako RW.' },
                        { label: '/VM',                          detail: 'Option',       doc: 'Virtuální paměť – použij VM adresu.' },

                        // ── Makra pro inline data ─────────────────────────────────
                        { label: '%%LE',                         detail: 'Macro',        doc: 'Little-endian inline data.' },
                        { label: '%%BE',                         detail: 'Macro',        doc: 'Big-endian inline data.' },
                        { label: '%%LONG',                       detail: 'Macro',        doc: '32-bit hodnota inline.' },
                        { label: '%%WORD',                       detail: 'Macro',        doc: '16-bit hodnota inline.' },
                        { label: '%%BYTE',                       detail: 'Macro',        doc: '8-bit hodnota inline.' },
                    ];

                    for (const cmd of trace32Commands) {
                        const item = new vscode.CompletionItem(cmd.label, vscode.CompletionItemKind.Function);
                        item.detail = `Lauterbach / ${cmd.detail}`;
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
                            {label: 'endif', detail: '', doc: 'End of statement'},
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
