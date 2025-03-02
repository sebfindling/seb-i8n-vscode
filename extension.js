// extension.js - Añadir sidebar con diccionario
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// Store the current dictionary
let currentDictionary = null;
let dictionaryLanguage = 'es'; // Default language
// Declare updateDecorations at the module level
let updateDecorations = () => {}; // Initially a no-op function
// Toggle for showing translations inline
let showTranslations = false;
// Dictionary view provider
let dictionaryViewProvider = null;

/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('Extensión Vista Previa i8n activa');

  // Register the command to select a dictionary file
  let selectDictionaryCommand = vscode.commands.registerCommand(
    'i8nPreview.selectDictionary',
    async () => {
      await selectDictionaryFile();
    }
  );

  // Register command to toggle translation view
  let toggleTranslationsCommand = vscode.commands.registerCommand(
    'i8nPreview.toggleTranslations',
    () => {
      showTranslations = !showTranslations;
      updateStatusBar();
      updateDecorations();
      vscode.window.showInformationMessage(
        showTranslations 
          ? 'Mostrando traducciones en el editor' 
          : 'Mostrando claves i8n originales'
      );
    }
  );
  
  // Register command to toggle dictionary sidebar
  let toggleDictionarySidebarCommand = vscode.commands.registerCommand(
    'i8nPreview.toggleDictionarySidebar',
    () => {
      // Actualizar las claves del archivo actual
      dictionaryViewProvider.updateKeysInCurrentFile();
      dictionaryViewProvider.show();
    }
  );

  // Registrar comando para hacer clic en los elementos especiales
  let handleTreeItemClickCommand = vscode.commands.registerCommand(
    'i8nPreview.handleTreeItemClick',
    (item) => {
      return dictionaryViewProvider.handleItemClick(item);
    }
  );
  
  // Register command for search button in the dictionary view
  let showSearchCommand = vscode.commands.registerCommand(
    'i8nPreview.showSearch',
    () => {
      dictionaryViewProvider.showSearchBox();
    }
  );
  
  // Register command to search for key in editor
  let searchKeyInEditorCommand = vscode.commands.registerCommand(
    'i8nPreview.searchKeyInEditor',
    (key) => {
      // Si es un elemento especial, manejarlo de forma diferente
      if (typeof key === 'object' && key.key) {
        if (dictionaryViewProvider.handleItemClick(key)) {
          return;
        }
        key = key.key;
      }
      
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        // Crear una expresión regular para buscar el key
        const searchRegex = new RegExp(`__\\(['"]${key}['"]\\)`, 'g');
        
        // Búsqueda manual
        const text = editor.document.getText();
        const matches = [];
        let match;
        
        while ((match = searchRegex.exec(text)) !== null) {
          const startPosition = editor.document.positionAt(match.index);
          const endPosition = editor.document.positionAt(match.index + match[0].length);
          matches.push(new vscode.Range(startPosition, endPosition));
        }
        
        if (matches.length > 0) {
          // Seleccionar la primera ocurrencia
          editor.selection = new vscode.Selection(matches[0].start, matches[0].end);
          editor.revealRange(matches[0], vscode.TextEditorRevealType.InCenter);
          
          // Abrir el widget de búsqueda con la clave
          vscode.commands.executeCommand('editor.actions.findWithArgs', { 
            searchString: key,
            isRegex: false,
            matchCase: true,
            matchWholeWord: false
          });
        } else {
          vscode.window.showInformationMessage(`No se encontraron ocurrencias de "${key}" en este archivo.`);
        }
      }
    }
  );
  
  
  
  
  // Register icon in title bar
  const toggleCommandOptions = {
    dark: vscode.Uri.file(path.join(context.extensionPath, 'resources', 'dark', 'translate.svg')),
    light: vscode.Uri.file(path.join(context.extensionPath, 'resources', 'light', 'translate.svg'))
  };

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

  // Create decoration type for replacement text
  const replacementDecorationType = vscode.window.createTextEditorDecorationType({
    before: {
      backgroundColor: 'rgba(150, 200, 255, 0.1)',
      border: '1px solid rgb(100, 150, 255)',
      borderRadius: '3px',
      contentText: '',
      margin: '0 0 0 0',
      width: 'auto'
    },
    textDecoration: 'none; display: none'
  });

  // Register the hover provider for i8n strings
  const hoverProvider = vscode.languages.registerHoverProvider(
    ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    {
      provideHover(document, position, token) {
        if (!currentDictionary) {
          return new vscode.Hover('No hay diccionario seleccionado. Usa el comando "i8n: Seleccionar Diccionario".');
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
            const translation = currentDictionary[key] || 'TRADUCCIÓN FALTANTE';
            
            const markdown = new vscode.MarkdownString();
            markdown.appendCodeblock(`${key} → "${translation}"`, 'javascript');
            markdown.appendMarkdown(`\n\nDiccionario: ${dictionaryLanguage}`);
            
            return new vscode.Hover(markdown);
          }
        }
      }
    }
  );

  // Update decorations on editor change
  let activeEditor = vscode.window.activeTextEditor;
  
  // Redefine the updateDecorations function
  updateDecorations = function() {
    if (!activeEditor || !currentDictionary) {
      return;
    }

    const text = activeEditor.document.getText();
    const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;
    
    const i8nDecorations = [];
    const missingI8nDecorations = [];
    const replacementDecorations = [];
    
    let match;
    while ((match = i8nRegex.exec(text)) !== null) {
      const key = match[1];
      const startPos = activeEditor.document.positionAt(match.index);
      const endPos = activeEditor.document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);
      
      const hasTranslation = !!currentDictionary[key];
      const translation = currentDictionary[key] || 'FALTA TRADUCCIÓN';
      
      if (showTranslations) {
        // When showing translations, replace the entire i8n call with just the translation
        replacementDecorations.push({
          range: range,
          renderOptions: {
            before: {
              contentText: `"${translation}"`,
              backgroundColor: hasTranslation ? 'rgba(150, 200, 255, 0.1)' : 'rgba(255, 100, 100, 0.1)',
              border: hasTranslation ? '1px solid rgb(100, 150, 255)' : '1px solid rgb(255, 100, 100)',
            }
          }
        });
      } else {
        // In normal mode, show the i8n call with the translation alongside
        const decoration = {
          range: range,
          hoverMessage: `${key} → "${translation}"`,
          renderOptions: {
            after: {
              contentText: ` → "${translation}"`,
              color: hasTranslation ? 'rgba(0, 100, 255, 0.6)' : 'rgba(255, 50, 50, 0.8)',
              fontStyle: 'italic'
            }
          }
        };
        
        if (hasTranslation) {
          i8nDecorations.push(decoration);
        } else {
          missingI8nDecorations.push(decoration);
        }
      }
    }
    
    // Apply the appropriate decorations based on the current mode
    if (showTranslations) {
      activeEditor.setDecorations(replacementDecorationType, replacementDecorations);
      activeEditor.setDecorations(i8nDecorationType, []);
      activeEditor.setDecorations(missingI8nDecorationType, []);
    } else {
      activeEditor.setDecorations(replacementDecorationType, []);
      activeEditor.setDecorations(i8nDecorationType, i8nDecorations);
      activeEditor.setDecorations(missingI8nDecorationType, missingI8nDecorations);
    }
  };

  // Dictionary sidebar view provider
  
  class DictionaryViewProvider {
    constructor(context) {
      this.view = null;
      this._onDidChangeTreeData = new vscode.EventEmitter();
      this.onDidChangeTreeData = this._onDidChangeTreeData.event;
      this.context = context;
      this.searchValue = '';
      this.keysInCurrentFile = new Set();
      // Siempre mostrar solo claves del archivo actual
    }
  
    show() {
      vscode.commands.executeCommand('workbench.view.explorer').then(() => {
        setTimeout(() => {
          vscode.commands.executeCommand('workbench.view.extension.i8nPreviewDictionary');
          this.showSearchBox();
        }, 100);
      });
    }
  
    showSearchBox() {
      // Crear un input box para búsqueda
      vscode.window.showInputBox({
        placeHolder: 'Buscar en el diccionario...',
        prompt: 'Ingresa texto para filtrar las claves y traducciones',
        value: this.searchValue
      }).then(value => {
        if (value !== undefined) { // Si no se canceló
          this.searchValue = value;
          this.refresh();
        }
      });
    }
  
    // Actualizar las claves en el archivo actual
    updateKeysInCurrentFile() {
      this.keysInCurrentFile.clear();
      
      const editor = vscode.window.activeTextEditor;
      if (editor && currentDictionary) {
        const text = editor.document.getText();
        const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;
        
        let match;
        while ((match = i8nRegex.exec(text)) !== null) {
          const key = match[1];
          this.keysInCurrentFile.add(key);
        }
      }
      this.refresh();
    }
  
    refresh() {
      this._onDidChangeTreeData.fire();
    }
  
    getTreeItem(element) {
      const hasTranslation = element.value !== 'TRADUCCIÓN FALTANTE';
      
      // Crear elemento con icono según si tiene traducción
      const treeItem = new vscode.TreeItem(
        `${element.key}: ${element.value}`,
        vscode.TreeItemCollapsibleState.None
      );
      
      treeItem.tooltip = `${element.key} → "${element.value}"`;
      treeItem.command = {
        command: 'i8nPreview.searchKeyInEditor',
        title: 'Buscar clave en el editor',
        arguments: [element.key]
      };
      
      // Añadir icono según el estado
      treeItem.iconPath = hasTranslation 
        ? new vscode.ThemeIcon('check')
        : new vscode.ThemeIcon('warning');
      
      // Si está en el archivo actual, destacarlo
      if (this.keysInCurrentFile.has(element.key)) {
        treeItem.contextValue = 'dictionaryEntryInFile';
      } else {
        treeItem.contextValue = 'dictionaryEntry';
      }
      
      return treeItem;
    }
  
    getChildren(element) {
      if (!currentDictionary) {
        return
        return [{ 
          key: 'NO_DICTIONARY', 
          value: 'No hay diccionario seleccionado. Usa el comando "i8n: Seleccionar Diccionario".' 
        }];
      }
  
      if (element) {
        return [];
      }
  
      // Crear un item de búsqueda al principio de la lista
      const items = [];
      
      // Añadir un elemento especial para el buscador
      items.push({
        key: '🔍 BUSCAR',
        value: this.searchValue || 'Clic para buscar',
        isSearchButton: true
      });
      
      // Filtrar las entradas - mostrar SÓLO las claves del archivo actual
      const filteredEntries = Object.entries(currentDictionary)
        .filter(([key, value]) => {
          // Solo mostrar claves del archivo actual
          if (!this.keysInCurrentFile.has(key)) {
            return false;
          }
          
          // Filtrar por término de búsqueda
          if (this.searchValue === '') {
            return true;
          }
          
          const searchLower = this.searchValue.toLowerCase();
          return key.toLowerCase().includes(searchLower) ||
                 (value && value.toString().toLowerCase().includes(searchLower));
        })
        .map(([key, value]) => ({ 
          key, 
          value: value || 'TRADUCCIÓN FALTANTE' 
        }));
  
      return [...items, ...filteredEntries];
    }
  
    // Manejar clics en los elementos especiales
    handleItemClick(item) {
      if (item.isSearchButton) {
        this.showSearchBox();
        return true;
      }
      
      return false;
    }
  }
  

  // Create and register the Dictionary view provider
  dictionaryViewProvider = new DictionaryViewProvider(context);
  const dictionaryTreeView = vscode.window.createTreeView('i8nPreviewDictionary', {
    treeDataProvider: dictionaryViewProvider,
    showCollapseAll: false
  });

  // Watch for changes
  vscode.window.onDidChangeActiveTextEditor(editor => {
    activeEditor = editor;
    if (editor) {
      updateDecorations();
      dictionaryViewProvider.updateKeysInCurrentFile();
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    if (activeEditor && event.document === activeEditor.document) {
      updateDecorations();
      dictionaryViewProvider.updateKeysInCurrentFile();
    }
  }, null, context.subscriptions);

  // Initial update
  if (activeEditor) {
    updateDecorations();
  }

  // Register status bar item to show current dictionary
  const dictionaryStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  dictionaryStatusBarItem.command = 'i8nPreview.selectDictionary';
  
  // Register status bar item for toggling translations
  const toggleStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  toggleStatusBarItem.command = 'i8nPreview.toggleTranslations';
  
  // Register status bar item for toggling dictionary sidebar
  const toggleDictionarySidebarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
  toggleDictionarySidebarItem.text = '$(eye) Diccionario';
  toggleDictionarySidebarItem.tooltip = 'Mostrar panel de diccionario';
  toggleDictionarySidebarItem.command = 'i8nPreview.toggleDictionarySidebar';
  toggleDictionarySidebarItem.show();
  
  function updateStatusBar() {
    if (currentDictionary) {
      dictionaryStatusBarItem.text = `$(globe) i8n: ${dictionaryLanguage}`;
      dictionaryStatusBarItem.tooltip = 'Clic para cambiar diccionario';
      dictionaryStatusBarItem.show();
      
      toggleStatusBarItem.text = showTranslations ? 
        `$(eye) Mostrando Traducciones` : 
        `$(code) Mostrando Claves`;
      toggleStatusBarItem.tooltip = showTranslations ? 
        'Clic para mostrar claves i8n originales' : 
        'Clic para mostrar traducciones en el editor';
      toggleStatusBarItem.show();
      
      toggleDictionarySidebarItem.show();
      
      // Refresh dictionary view when dictionary changes
      dictionaryViewProvider.refresh();
    } else {
      dictionaryStatusBarItem.text = '$(warning) i8n: Sin Diccionario';
      dictionaryStatusBarItem.tooltip = 'Clic para seleccionar un diccionario';
      dictionaryStatusBarItem.show();
      toggleStatusBarItem.hide();
      toggleDictionarySidebarItem.hide();
    }
  }

  updateStatusBar();

  // Add updateDecorations reference to outer scope
  context.subscriptions.push(
    selectDictionaryCommand,
    toggleTranslationsCommand,
    toggleDictionarySidebarCommand,
    searchKeyInEditorCommand,
    handleTreeItemClickCommand,
    showSearchCommand,
    hoverProvider,
    i8nDecorationType,
    missingI8nDecorationType,
    replacementDecorationType,
    dictionaryStatusBarItem,
    toggleStatusBarItem,
    toggleDictionarySidebarItem,
    dictionaryTreeView
  );

  // Try to load dictionary automatically on startup
  // findAndLoadDictionary();
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
    vscode.window.showErrorMessage('No se encontraron archivos de diccionario en el espacio de trabajo.');
    return;
  }
  
  const selected = await vscode.window.showQuickPick(
    dictionaryFiles.map(file => ({
      label: file.language.toUpperCase(),
      description: file.path,
      detail: `Cargar diccionario ${file.language}`,
      path: file.path,
      language: file.language
    })),
    {
      placeHolder: 'Selecciona un archivo de diccionario para previsualizar cadenas i8n',
      title: 'Selección de Diccionario i8n'
    }
  );
  
  if (selected) {
    loadDictionary(selected.path);
    dictionaryLanguage = selected.language;
    vscode.window.showInformationMessage(`Diccionario cargado: "${selected.language}".`);
    
    // Refresh decorations
    updateDecorations();
  }
}

/**
 * Load a dictionary file
 * @param {string} filePath Path to the dictionary file
 */
function loadDictionary(filePath) {
  try {
    // Leer el contenido completo del archivo
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Log del principio del archivo para ayudar con la depuración
    console.log(`Archivo cargado: ${filePath}`);
    console.log(`Tamaño del archivo: ${fileContent.length} bytes`);
    
    // Enfoque más directo: usar require() para cargar el módulo JavaScript directamente
    // Esto evita tener que analizar el JSON manualmente
    try {
      // Crear un archivo temporal con el contenido
      const tempFile = path.join(path.dirname(filePath), `._temp_${Date.now()}.js`);
      fs.writeFileSync(tempFile, fileContent);
      
      // Eliminar cualquier caché previa
      delete require.cache[require.resolve(tempFile)];
      
      // Cargar el módulo
      const dictionaryModule = require(tempFile);
      // El diccionario puede ser el módulo mismo o una propiedad de este
      currentDictionary = dictionaryModule.default || dictionaryModule;
      
      // Limpiar
      setTimeout(() => {
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.error(`Error al eliminar archivo temporal: ${e.message}`);
        }
      }, 1000);
      
      console.log(`Diccionario cargado correctamente con ${Object.keys(currentDictionary).length} claves`);
      return true;
    } catch (requireError) {
      console.error(`Error usando require(): ${requireError.message}`);
      
      // Plan B: evaluar el archivo en un contexto controlado
      try {
        // Extraer solo el objeto del diccionario
        const dictionaryMatch = fileContent.match(/(const\s+\w+\s*=\s*)({[\s\S]*?})(;\s*(export|module))/m);
        
        if (dictionaryMatch && dictionaryMatch[2]) {
          const dictionaryStr = dictionaryMatch[2];
          console.log(`Objeto extraído (primeros 100 caracteres): ${dictionaryStr.substring(0, 100)}...`);
          
          // Evaluar el objeto en un contexto seguro
          const safeEval = (code) => {
            return Function('"use strict"; return (' + code + ')')();
          };
          
          currentDictionary = safeEval(dictionaryStr);
          console.log(`Diccionario evaluado correctamente con ${Object.keys(currentDictionary).length} claves`);
          return true;
        } else {
          console.error('No se pudo extraer el objeto del diccionario');
          vscode.window.showErrorMessage('No se pudo extraer el objeto del diccionario. El formato no es compatible.');
        }
      } catch (evalError) {
        console.error(`Error en evaluación: ${evalError.message}`);
        vscode.window.showErrorMessage(`Error al evaluar el diccionario: ${evalError.message}`);
      }
    }
  } catch (error) {
    console.error(`Error al leer archivo: ${error.message}`);
    vscode.window.showErrorMessage(`Error al leer archivo de diccionario: ${error.message}`);
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