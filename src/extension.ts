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
    let completionItems: vscode.CompletionItem[] = [];

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
                        completionItems.push(item);
                    }
                }
            }
        }

        console.log(`Loaded ${completionItems.length} completion items from INI files: ${iniFiles.join(', ')}`);
    } else {
        console.warn(`TEMPLATES folder not found at: ${templatesFolder}`);
    }

    const provider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'uds-template' },
        {
            provideCompletionItems() {
                return completionItems;
            }
        }
    );

    context.subscriptions.push(provider);
}

export function deactivate() {}
