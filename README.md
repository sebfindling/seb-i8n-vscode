# Seb: i8n para VSCode
### Herramienta para ver las traducciones de mi librería i8n dentro del editor

Incluye múltiples funcionalidades súper útiles:
* Ver traducciones dentro del editor como información extra
* Ver traducciones dentro del editor en reemplazo del string original
* Ver traducciones dentro del editor en un hover
* Cambiar de diccionario de traducciones
* Panel lateral con las keys usadas en el archivo actual

#### Resultado
![image](https://github.com/user-attachments/assets/e541dde1-1f7e-4abe-8443-91f821fc6f97)

Editar desde Tooltip:

<img width="269" height="121" alt="image" src="https://github.com/user-attachments/assets/3f9f3a35-840c-46cb-827e-8159d8120bb5" />


Panel de keys con buscador:

![image](https://github.com/user-attachments/assets/9e74afaa-8549-4d79-a493-fc253844c4d6)



## Descargar
[Descargar la versión más reciente de la página de Releases](https://github.com/sebfindling/seb-i8n-vscode/releases)

## Alternativa: Compilar e instalar desde código fuente
1. Crear paquete VSIX
```
npx -y @vscode/vsce package
```

2. Presionar `Ctrl+Shift+P` en VScode y buscar `Install from VSIX`.
 
