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
                        StatiscompletionItems.push(item);
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
						const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Value);
						
						item.detail = key.detail;
						item.documentation = new vscode.MarkdownString(key.doc);
						item.insertText = key.label;

						completionItems.push(item);
					}
				}
				// trace32 commands specific values
				if (lineText.includes('!batch(')){
					const setKey = [
						{label: '', detail: '', doc: ''},
						{label: '', detail: '', doc: ''}
					];
					for (const key of setKey) {
						const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Value);
						
						item.detail = key.detail;
						item.documentation = new vscode.MarkdownString(key.doc);
						item.insertText = key.label;

						completionItems.push(item);
					}
				}
				// TEMPLATES_PARAMETERS commands specific values
				const setKey = [
					{label: '@IF', detail: '', doc: ''},
					{label: '@ELIF', detail: '', doc: ''},
					{label: '@ELSE', detail: '', doc: ''},
					{label: '@ENDIF', detail: '', doc: ''}
				];
				for (const key of setKey) {
					const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Value);
					
					item.detail = key.detail;
					item.documentation = new vscode.MarkdownString(key.doc);
					item.insertText = key.label;

					completionItems.push(item);
				}
                return completionItems;
            }
        }
    );

    context.subscriptions.push(provider);
}

export function deactivate() {}
