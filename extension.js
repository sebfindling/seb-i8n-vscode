// extension.js
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// Store the current dictionary
let currentDictionary = null;
let dictionaryLanguage = 'es'; // Default language

/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('i8n Dictionary Preview extension is now active');

  // Register the command to select a dictionary file
  let selectDictionaryCommand = vscode.commands.registerCommand(
    'i8nPreview.selectDictionary',
    async () => {
      await selectDictionaryFile();
    }
  );

  // Create decoration type for i8n strings
  const i8nDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(150, 200, 255, 0.1)',
    border: '1px dashed rgb(100, 150, 255)',
    borderRadius: '3px'
  });

  // Create decoration type for missing i8n strings
  const missingI8nDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 100, 100, 0.1)',
    border: '1px dashed rgb(255, 100, 100)',
    textDecoration: 'underline wavy rgb(255, 100, 100)',
    borderRadius: '3px'
  });

  // Register the hover provider for i8n strings
  const hoverProvider = vscode.languages.registerHoverProvider(
    ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    {
      provideHover(document, position, token) {
        if (!currentDictionary) {
          return new vscode.Hover('No dictionary selected. Use the "i8n: Select Dictionary" command.');
        }

        const range = document.getWordRangeAtPosition(position);
        if (!range) return;

        const line = document.lineAt(position.line).text;
        const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;
        let match;

        while ((match = i8nRegex.exec(line)) !== null) {
          const start = match.index;
          const end = match.index + match[0].length;
          
          if (position.character >= start && position.character <= end) {
            const key = match[1];
            const translation = currentDictionary[key] || 'MISSING TRANSLATION';
            
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(`${key} → "${translation}"`, 'javascript');
            markdown.appendMarkdown(`\n\nDictionary: ${dictionaryLanguage}`);
            
            return new vscode.Hover(markdown);
          }
        }
      }
    }
  );

  // Update decorations on editor change
  let activeEditor = vscode.window.activeTextEditor;
  
  function updateDecorations() {
    if (!activeEditor || !currentDictionary) {
      return;
    }

    const text = activeEditor.document.getText();
    const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;
    
    const i8nDecorations = [];
    const missingI8nDecorations = [];
    
    let match;
    while ((match = i8nRegex.exec(text)) !== null) {
      const key = match[1];
      const startPos = activeEditor.document.positionAt(match.index);
      const endPos = activeEditor.document.positionAt(match.index + match[0].length);
      
      const decoration = {
        range: new vscode.Range(startPos, endPos),
        hoverMessage: `${key} → "${currentDictionary[key] || 'MISSING TRANSLATION'}"`,
        renderOptions: {
          after: {
            contentText: ` → "${currentDictionary[key] || 'MISSING'}"`,
            color: currentDictionary[key] ? 'rgba(0, 100, 255, 0.6)' : 'rgba(255, 50, 50, 0.8)',
            fontStyle: 'italic'
          }
        }
      };
      
      if (currentDictionary[key]) {
        i8nDecorations.push(decoration);
      } else {
        missingI8nDecorations.push(decoration);
      }
    }
    
    activeEditor.setDecorations(i8nDecorationType, i8nDecorations);
    activeEditor.setDecorations(missingI8nDecorationType, missingI8nDecorations);
  }

  // Watch for changes
  vscode.window.onDidChangeActiveTextEditor(editor => {
    activeEditor = editor;
    if (editor) {
      updateDecorations();
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    if (activeEditor && event.document === activeEditor.document) {
      updateDecorations();
    }
  }, null, context.subscriptions);

  // Initial update
  if (activeEditor) {
    updateDecorations();
  }

  // Register status bar item to show current dictionary
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'i8nPreview.selectDictionary';
  
  function updateStatusBar() {
    if (currentDictionary) {
      statusBarItem.text = `$(globe) i8n: ${dictionaryLanguage}`;
      statusBarItem.tooltip = 'Click to change dictionary';
      statusBarItem.show();
    } else {
      statusBarItem.text = '$(warning) i8n: No Dictionary';
      statusBarItem.tooltip = 'Click to select a dictionary';
      statusBarItem.show();
    }
  }

  updateStatusBar();

  // Add all items to subscriptions
  context.subscriptions.push(
    selectDictionaryCommand,
    hoverProvider,
    i8nDecorationType,
    missingI8nDecorationType,
    statusBarItem
  );

  // Try to load dictionary automatically on startup
  findAndLoadDictionary();
}

/**
 * Find and load a dictionary automatically
 */
async function findAndLoadDictionary() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  
  if (!workspaceFolders) {
    return;
  }

  const dictionaryFiles = await findDictionaryFiles();
  
  if (dictionaryFiles.length === 1) {
    // If there's only one dictionary file, load it automatically
    loadDictionary(dictionaryFiles[0].path);
    dictionaryLanguage = dictionaryFiles[0].language;
  } else if (dictionaryFiles.length > 1) {
    // If there are multiple dictionary files, prompt to select one
    selectDictionaryFile();
  }
}

/**
 * Find all potential dictionary files in the workspace
 */
async function findDictionaryFiles() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return [];
  }

  const potentialFiles = [];
  
  // Search for common dictionary file patterns
  const searchPattern = '{**/lang/*.js,**/i18n/*.js,**/translations/*.js,**/locales/*.js}';
  const files = await vscode.workspace.findFiles(searchPattern);
  
  for (const file of files) {
    const fileName = path.basename(file.fsPath, '.js');
    // Check if filename is a language code (2-3 characters)
    if (fileName.length <= 3 || fileName === 'en' || fileName === 'es') {
      potentialFiles.push({
        path: file.fsPath,
        language: fileName,
        label: `${fileName.toUpperCase()} (${file.fsPath})`
      });
    }
  }
  
  return potentialFiles;
}

/**
 * Show dialog to select a dictionary file
 */
async function selectDictionaryFile() {
  const dictionaryFiles = await findDictionaryFiles();
  
  if (dictionaryFiles.length === 0) {
    vscode.window.showErrorMessage('No dictionary files found in the workspace.');
    return;
  }
  
  const selected = await vscode.window.showQuickPick(
    dictionaryFiles.map(file => ({
      label: file.language.toUpperCase(),
      description: file.path,
      detail: `Load ${file.language} dictionary`,
      path: file.path,
      language: file.language
    })),
    {
      placeHolder: 'Select a dictionary file to use for previewing i8n strings',
      title: 'i8n Dictionary Selection'
    }
  );
  
  if (selected) {
    loadDictionary(selected.path);
    dictionaryLanguage = selected.language;
    vscode.window.showInformationMessage(`Loaded ${selected.language} dictionary.`);
    
    // Refresh decorations
    if (vscode.window.activeTextEditor) {
      updateDecorations();
    }
  }
}

/**
 * Load a dictionary file
 * @param {string} filePath Path to the dictionary file
 */
function loadDictionary(filePath) {
  try {
    // Read the file content
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Extract the dictionary object using regex
    const dictionaryMatch = fileContent.match(/export\s+default\s+({[\s\S]*?})/m);
    
    if (dictionaryMatch && dictionaryMatch[1]) {
      // Convert the dictionary string to an object
      const dictionaryStr = dictionaryMatch[1]
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Fix keys
        .replace(/'/g, '"'); // Replace single quotes with double quotes
      
      try {
        currentDictionary = JSON.parse(dictionaryStr);
        return true;
      } catch (jsonError) {
        vscode.window.showErrorMessage(`Error parsing dictionary: ${jsonError.message}`);
      }
    } else {
      vscode.window.showErrorMessage('Could not extract dictionary from the file.');
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error loading dictionary: ${error.message}`);
  }
  
  return false;
}

/**
 * Deactivate the extension
 */
function deactivate() {
  // Cleanup if needed
}

module.exports = {
  activate,
  deactivate
};