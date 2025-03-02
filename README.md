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

Alternar vista:

![image](https://github.com/user-attachments/assets/9d53b81f-c2d4-49cd-af9f-254a0e18bb43)
![image](https://github.com/user-attachments/assets/79b2cc19-1ceb-44bb-a2ba-c509b861c139)

Panel de keys con buscador:

![image](https://github.com/user-attachments/assets/6cd6f40d-9ab3-4913-b5c9-e1e9350110d5)



## Descargar
[Descargar la versión más reciente de la página de Releases](https://github.com/sebfindling/seb-i8n-vscode/releases)

## Alternativa: Compilar e instalar desde código fuente
1. Crear paquete VSIX
```
npx -y @vscode/vsce package
```

2. Presionar `Ctrl+Shift+P` en VScode y buscar `Install from VSIX`.
 
