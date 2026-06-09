// extension.js - Añadir sidebar con diccionario
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// Store the current dictionary
let currentDictionary = null;
let currentDictionaryPath = null;
let dictionaryLanguage = 'es'; // Default language
// All discovered dictionaries: { language: { path, data } }
let allDictionaries = {};
// Declare updateDecorations at the module level
let updateDecorations = () => { }; // Initially a no-op function
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

  // Register command to open a dictionary file at a specific line
  let openDictionaryAtKeyCommand = vscode.commands.registerCommand(
    'i8nPreview.openDictionaryAtKey',
    async (filePath, lineNum) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(lineNum, 0, lineNum, 1000)
      });
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
      provideHover(document, position) {
        if (!currentDictionary) return;

        const lineText = document.lineAt(position.line).text;
        const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;
        let match;

        while ((match = i8nRegex.exec(lineText)) !== null) {
          const start = match.index;
          const end = match.index + match[0].length;

          if (position.character >= start && position.character <= end) {
            const key = match[1];
            const markdown = new vscode.MarkdownString('', true);
            markdown.isTrusted = true;
            markdown.supportThemeIcons = true;

            markdown.appendMarkdown(`**\`${key}\`**\n\n`);

            const langs = Object.entries(allDictionaries);
            if (langs.length === 0) {
              // fallback if allDictionaries not loaded yet
              const translation = currentDictionary[key] || '*(missing)*';
              markdown.appendMarkdown(`**${dictionaryLanguage.toUpperCase()}**: ${translation}\n\n`);
            } else {
              for (const [lang, { path: dictPath, data }] of langs) {
                const translation = data[key];
                const isCurrent = lang === dictionaryLanguage;
                const langLabel = isCurrent ? `**${lang.toUpperCase()}**` : lang.toUpperCase();
                if (translation) {
                  const lineNum = findKeyLineInFile(dictPath, key);
                  const args = encodeURIComponent(JSON.stringify([dictPath, lineNum]));
                  markdown.appendMarkdown(
                    `${langLabel}: "${translation}" &nbsp;[$(edit)](command:i8nPreview.openDictionaryAtKey?${args} "Edit in ${lang}")\n\n`
                  );
                } else {
                  markdown.appendMarkdown(`${langLabel}: *(missing)*\n\n`);
                }
              }
            }

            return new vscode.Hover(markdown);
          }
        }
      }
    }
  );

  // Register Go to Definition provider for i8n strings
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    {
      async provideDefinition(document, position) {
        if (!currentDictionary || !currentDictionaryPath) return;

        const line = document.lineAt(position.line).text;
        const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;
        let match;

        while ((match = i8nRegex.exec(line)) !== null) {
          const start = match.index;
          const end = match.index + match[0].length;

          if (position.character >= start && position.character <= end) {
            const key = match[1];
            const dictionaryFolder = path.dirname(currentDictionaryPath);

            let jsFiles;
            try {
              jsFiles = fs.readdirSync(dictionaryFolder)
                .filter(f => f.endsWith('.js'))
                .map(f => path.join(dictionaryFolder, f));
            } catch {
              return;
            }

            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const keyDefRegex = new RegExp(`(['"]?)${escapedKey}\\1\\s*:`, 'g');
            const locations = [];

            for (const jsFile of jsFiles) {
              let content;
              try {
                content = fs.readFileSync(jsFile, 'utf8');
              } catch {
                continue;
              }

              let keyMatch;
              while ((keyMatch = keyDefRegex.exec(content)) !== null) {
                const before = content.substring(0, keyMatch.index);
                const lineNum = before.split('\n').length - 1;
                const colNum = before.length - before.lastIndexOf('\n') - 1;
                locations.push(new vscode.Location(
                  vscode.Uri.file(jsFile),
                  new vscode.Position(lineNum, colNum)
                ));
              }
              keyDefRegex.lastIndex = 0;
            }

            return locations;
          }
        }
      }
    }
  );

  // Update decorations on editor change
  let activeEditor = vscode.window.activeTextEditor;

  // Redefine the updateDecorations function
  updateDecorations = function () {
    if (!activeEditor || !currentDictionary) {
      return;
    }

    const text = activeEditor.document.getText();
    const i8nRegex = /__\(['"]([^'"]+)['"]\)/g;

    const replacementDecorations = [];

    let match;
    while ((match = i8nRegex.exec(text)) !== null) {
      const key = match[1];
      const startPos = activeEditor.document.positionAt(match.index);
      const endPos = activeEditor.document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      const hasTranslation = !!currentDictionary[key];
      const translation = currentDictionary[key] || 'FALTA TRADUCCIÓN';

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
    }

    activeEditor.setDecorations(replacementDecorationType, replacementDecorations);
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
      if (this.searchValue) {
        items.push({
          key: '🔍 BUSCANDO',
          value: this.searchValue,// || 'Clic para buscar',
          isSearchButton: true
        });
      }

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

      toggleDictionarySidebarItem.show();

      // Refresh dictionary view when dictionary changes
      dictionaryViewProvider.refresh();
    } else {
      dictionaryStatusBarItem.text = '$(warning) i8n: Sin Diccionario';
      dictionaryStatusBarItem.tooltip = 'Clic para seleccionar un diccionario';
      dictionaryStatusBarItem.show();
      toggleDictionarySidebarItem.hide();
    }
  }

  updateStatusBar();

  // Add updateDecorations reference to outer scope
  context.subscriptions.push(
    selectDictionaryCommand,
    openDictionaryAtKeyCommand,
    toggleDictionarySidebarCommand,
    searchKeyInEditorCommand,
    handleTreeItemClickCommand,
    showSearchCommand,
    hoverProvider,
    definitionProvider,
    replacementDecorationType,
    dictionaryStatusBarItem,
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

    // Actualizar la barra de estado
    if (dictionaryStatusBarItem) {
      dictionaryStatusBarItem.text = `$(globe) i8n: ${dictionaryLanguage}`;
      dictionaryStatusBarItem.tooltip = 'Clic para cambiar diccionario';
      dictionaryStatusBarItem.show();

      toggleDictionarySidebarItem.show();
    }
  }
}

/**
 * Load a dictionary file
 * @param {string} filePath Path to the dictionary file
 */
function loadDictionary(filePath) {
  currentDictionaryPath = filePath;
  try {
    // Leer el contenido completo del archivo
    const fileContent = fs.readFileSync(filePath, 'utf8');
    let tempFile = null; // Declarar tempFile en el ámbito de la función completa

    // Log del principio del archivo para ayudar con la depuración
    console.log(`Archivo cargado: ${filePath}`);
    console.log(`Tamaño del archivo: ${fileContent.length} bytes`);

    // Definir la función de eliminación una sola vez
    const deleteTemporaryFile = (file, attempts = 1, maxAttempts = 5) => {
      if (!file) return;

      try {
        fs.unlinkSync(file);
        console.log(`Archivo temporal eliminado: ${file}`);
      } catch (e) {
        console.error(`Intento ${attempts}: Error al eliminar archivo temporal: ${e.message}`);

        // Si aún no hemos alcanzado el número máximo de intentos, reintentar
        if (attempts < maxAttempts) {
          // Incrementar el tiempo de espera exponencialmente (1s, 2s, 4s, 8s, etc.)
          const nextTimeout = Math.pow(2, attempts) * 1000;
          console.log(`Reintentando eliminar en ${nextTimeout / 1000} segundos...`);

          setTimeout(() => {
            deleteTemporaryFile(file, attempts + 1, maxAttempts);
          }, nextTimeout);
        } else {
          vscode.window.showWarningMessage(
            `No se pudo eliminar el archivo temporal: ${path.basename(file)}. Puede ser necesario eliminarlo manualmente.`
          );
        }
      }
    };

    // Enfoque más directo: usar require() para cargar el módulo JavaScript directamente
    try {
      // Crear un archivo temporal con el contenido
      tempFile = path.join(path.dirname(filePath), `._temp_${Date.now()}.js`);
      fs.writeFileSync(tempFile, fileContent);

      // Eliminar cualquier caché previa
      delete require.cache[require.resolve(tempFile)];

      // Cargar el módulo
      const dictionaryModule = require(tempFile);
      // El diccionario puede ser el módulo mismo o una propiedad de este
      currentDictionary = dictionaryModule.default || dictionaryModule;

      // Iniciar proceso de eliminación después de un retraso inicial
      setTimeout(() => {
        deleteTemporaryFile(tempFile);
      }, 2000); // Esperar 2 segundos antes del primer intento

      console.log(`Diccionario cargado correctamente con ${Object.keys(currentDictionary).length} claves`);

      // Actualizar las decoraciones
      updateDecorations();

      // Actualizar las claves en el archivo actual y refrescar la vista del diccionario
      if (dictionaryViewProvider) {
        dictionaryViewProvider.updateKeysInCurrentFile();
        dictionaryViewProvider.refresh();
      }

      loadAllDictionaries();
      return true;
    } catch (requireError) {
      console.error(`Error usando require(): ${requireError.message}`);

      // Plan B: evaluar el archivo en un contexto controlado
      try {
        // Si se creó un archivo temporal en el Plan A, intentar borrarlo
        if (tempFile) {
          setTimeout(() => {
            deleteTemporaryFile(tempFile);
          }, 2000);
        }

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

          // Actualizar las decoraciones
          updateDecorations();

          // Actualizar las claves en el archivo actual y refrescar la vista del diccionario
          if (dictionaryViewProvider) {
            dictionaryViewProvider.updateKeysInCurrentFile();
            dictionaryViewProvider.refresh();
          }

          loadAllDictionaries();
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
 * Extract dictionary data from a file without side effects.
 * Returns the dictionary object or null on failure.
 * @param {string} filePath
 */
function extractDictionaryData(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const tempFile = path.join(path.dirname(filePath), `._temp_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
    try {
      fs.writeFileSync(tempFile, fileContent);
      delete require.cache[require.resolve(tempFile)];
      const mod = require(tempFile);
      const data = mod.default || mod;
      setTimeout(() => { try { fs.unlinkSync(tempFile); } catch { } }, 2000);
      return data;
    } catch {
      try { fs.unlinkSync(tempFile); } catch { }
      const match = fileContent.match(/(const\s+\w+\s*=\s*)({[\s\S]*?})(;\s*(export|module))/m);
      if (match && match[2]) {
        return Function('"use strict"; return (' + match[2] + ')')();
      }
    }
  } catch { }
  return null;
}

/**
 * Load all .js files from the same folder as the current dictionary into allDictionaries.
 */
function loadAllDictionaries() {
  if (!currentDictionaryPath) return;
  const folder = path.dirname(currentDictionaryPath);
  allDictionaries = {};
  let jsFiles;
  try {
    jsFiles = fs.readdirSync(folder).filter(f => f.endsWith('.js') && !f.startsWith('._temp_'));
  } catch {
    return;
  }
  for (const file of jsFiles) {
    const lang = path.basename(file, '.js');
    const filePath = path.join(folder, file);
    const data = extractDictionaryData(filePath);
    if (data) {
      allDictionaries[lang] = { path: filePath, data };
    }
  }
}

/**
 * Find the 0-based line number of a key definition in a dictionary file.
 * @param {string} filePath
 * @param {string} key
 * @returns {number}
 */
function findKeyLineInFile(filePath, key) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyRegex = new RegExp(`(['"]?)${escapedKey}\\1\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (keyRegex.test(lines[i])) return i;
    }
  } catch { }
  return 0;
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