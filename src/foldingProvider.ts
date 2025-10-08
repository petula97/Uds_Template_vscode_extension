// Soubor: foldingProvider.ts

import * as vscode from 'vscode';

export class UdsFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        context: vscode.FoldingContext,
        token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        console.debug(`Folding requested for file: ${document.fileName}`);
        console.log(`Folding requested for file: ${document.fileName}`);
        const foldingRanges: vscode.FoldingRange[] = [];
        // Zásobník bude ukládat POUZE řádky začínající blok, tj. @if, @elif, @else
        // Budeme ukládat index řádku startu, KTERÝ MŮŽE být nahrazen
        const stack: number[] = []; 

        const regexIf = /^\s*@if\b/i;
        const regexElif = /^\s*@elif\b/i;
        const regexElse = /^\s*@else\b/i;
        const regexEndif = /^\s*@endif\b/i;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i).text;

            if (regexIf.test(line)) {
                // Začátek IF bloku. Pushujeme řádek IF na zásobník.
                stack.push(i);
            } else if (regexElif.test(line) || regexElse.test(line)) {
                // Nalezeno @elif nebo @else.
                if (stack.length > 0) {
                    // Ukončení předchozího rozsahu (např. @if... nebo @elif...)
                    const startLine = stack.pop()!;
                    // Rozsah je od startLine do řádku PŘED aktuálním řádkem (@elif/@else)
                    if (i > startLine + 1) { // +1 zajistí, že se skládá alespoň jeden řádek
                        foldingRanges.push(new vscode.FoldingRange(startLine, i - 1, vscode.FoldingRangeKind.Region));
                    }
                    // Aktuální řádek (@elif/@else) se stává novým začátkem rozsahu.
                    stack.push(i);
                }
            } else if (regexEndif.test(line)) {
                // Nalezeno @endif.
                if (stack.length > 0) {
                    const startLine = stack.pop()!;
                    // Ukončení posledního rozsahu (např. @if... nebo @else...)
                    // Rozsah je od startLine do řádku PŘED aktuálním řádkem (@endif)
                    if (i > startLine + 1) { // +1 zajistí, že se skládá alespoň jeden řádek
                        foldingRanges.push(new vscode.FoldingRange(startLine, i - 1, vscode.FoldingRangeKind.Region));
                    }
                }
            }
        }

        console.debug(`Found ${foldingRanges.length} folding ranges`);
        console.log(`Found ${foldingRanges.length} folding ranges`);

        return foldingRanges;
    }
}