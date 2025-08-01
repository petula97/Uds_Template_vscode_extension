import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
const ini = require('ini');

export function activate(context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const templatesFolder = path.join(workspaceFolders[0].uri.fsPath, 'TEMPLATES');
    let statiscompletionItems: vscode.CompletionItem[] = [];

	// Keywords add to the statiscompletionItems fro ini files
    if (fs.existsSync(templatesFolder)) {
        const iniFiles = fs.readdirSync(templatesFolder)
            .filter(file => file.toLowerCase().endsWith('.ini') && file.toLowerCase() !== 'config.ini');

        for (const file of iniFiles) {
            const iniPath = path.join(templatesFolder, file);
            const content = fs.readFileSync(iniPath, 'utf-8');
            const parsed = ini.parse(content);

            for (const section in parsed) {
                const keys = parsed[section];
                if (typeof keys === 'object') {
                    for (const key in keys) {
                        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Keyword);
                        item.detail = `[${section}] (${file})`;
                        item.documentation = `${key} = ${keys[key]}`;
                        statiscompletionItems.push(item);
                    }
                }
            }
        }

        console.log(`Loaded ${statiscompletionItems.length} completion items from INI files: ${iniFiles.join(', ')}`);
    } else {
        console.warn(`TEMPLATES folder not found at: ${templatesFolder}`);
    }



    const provider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'uds-template' },
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
				const lineText = document.lineAt(position).text;
				const completionItems: vscode.CompletionItem[] = [...statiscompletionItems];

				// Keywords completition for CANape
				const keywords = ['!sleep', '!prog', '!echo', '!dialog', '!baud', '!sa', '!repair', '!testerp', '!canid', '!pcheck', '!yield', '!suppress', '!set', '!batch', '!append', '!exit'];
				for (const keyword of keywords) {
					const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
					item.detail = 'CANape Script command';
					item.insertText = keyword;
					completionItems.push(item);
				}
				// !set option specific values
				if (lineText.includes('!set(')){
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
						const item = new vscode.CompletionItem(key.label, vscode.CompletionItemKind.Keyword);
						
						item.detail = key.detail;
						item.documentation = new vscode.MarkdownString(key.doc);
						item.insertText = key.label;

						completionItems.push(item);
					}
				}
				// trace32 commands specific values
				if (lineText.includes('!batch(')){
					const trace32Commands = [
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
					  const item = new vscode.CompletionItem(cmd.label, vscode.CompletionItemKind.Keyword);
					  item.detail = cmd.detail;
					  item.documentation = new vscode.MarkdownString(cmd.doc);
					  item.insertText = cmd.label;
					  completionItems.push(item);
					}

				}
				// TEMPLATES_PARAMETERS commands specific values
				if (lineText.startsWith('@')){
					const setKey = [
						{label: 'IF', detail: '', doc: 'test'},
						{label: 'ELIF', detail: '', doc: ''},
						{label: 'ELSE', detail: '', doc: ''},
						{label: 'ENDIF', detail: '', doc: ''}
					];
					for (const key of setKey) {
						const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Keyword);
						
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
}

export function deactivate() {}
