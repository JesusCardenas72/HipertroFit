# El Entrenador IA en el teléfono, con Ollama en el propio teléfono

Con esta configuración el Entrenador funciona entero en tu teléfono. HipertroFit prepara la
petición, Ollama (en Termux) responde en `127.0.0.1:11434` y la app valida la respuesta antes de
enseñártela. No sale ningún dato del teléfono: no hace falta servidor, ni clave de API, y no se
paga nada.

## Qué necesitas

- Android con 8 GB de RAM o más (con 12 GB vas holgado).
- Un APK de HipertroFit que incluya el Entrenador (versión posterior a 3.9.0, rama `coach-ia`).
  Necesita el permiso para hablar `http://` sin cifrar con `127.0.0.1`, que las versiones
  anteriores no tienen.
- **Termux de F-Droid** (https://f-droid.org/packages/com.termux/). La versión de la Play Store
  está desactualizada y sus paquetes no se instalan.
- Unos 3 GB libres para el modelo.

## 1. Instalar Ollama en Termux

```sh
pkg update && pkg upgrade
pkg install ollama
```

## 2. Arrancarlo con los ajustes adecuados

```sh
termux-wake-lock
OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_KEEP_ALIVE=-1 OLLAMA_NUM_PARALLEL=1 ollama serve &
```

- `OLLAMA_CONTEXT_LENGTH=16384` es **obligatorio**: el Entrenador envía entre 4.000 y 15.000
  tokens, y el contexto por defecto de Ollama (4.096) los recorta sin avisar, así que las
  respuestas salen rotas.
- `OLLAMA_KEEP_ALIVE=-1` mantiene el modelo cargado, para que el siguiente trabajo no relea
  todo desde cero.
- `termux-wake-lock` evita que Android duerma Termux. En Ajustes → Aplicaciones → Termux →
  Batería, elige «Sin restricciones».

## 3. Descargar el modelo (una sola vez)

```sh
ollama pull qwen2.5:3b
```

Empieza con `qwen2.5:3b` (unos 2 GB, unos 4 GB de RAM en uso). Con 12 GB puedes probar
`qwen2.5:7b` (unos 4,7 GB): razona mejor pero es dos o tres veces más lento. Deja solo el que
uses.

Comprueba que responde: `curl http://127.0.0.1:11434/v1/models`

## 4. Conectar HipertroFit

1. Ajustes → **Entrenador IA** (activado) → **Configurar el Entrenador en este teléfono**.
2. **En este teléfono: un modelo local o mi propia clave** → **Modelo local**.
3. Dirección: `http://127.0.0.1:11434` → **Probar**. Debe decir «¡Funciona! 1 modelo para elegir».
4. **Guardar y usar el entrenador**. La primera vez te pide el consentimiento y hace el
   cuestionario corto.

A partir de ahí: **Plan → Entrenador** para planes, revisiones y el chat, y el botón ✨ de cada
ejercicio durante el entreno.

## Qué esperar

- Con la CPU del teléfono, cada trabajo tarda **varios minutos** (leer una petición de 5.000–7.000
  tokens y escribir la respuesta). La app da hasta 25 minutos a un modelo local, y puedes salir
  del chat mientras tanto.
- Termux tiene que seguir abierto en segundo plano mientras el Entrenador trabaja. Si Android lo
  cierra, repite el paso 2.
- Un modelo de 3B se equivoca a veces. La app nunca aplica nada sin tu sí. Si una respuesta no es
  válida, pide una corrección una vez, y si sigue sin serlo el trabajo falla sin tocar tu plan.
- En esta versión, si usas un proveedor de pago en vez de Ollama, la clave de API se guarda solo
  en memoria y hay que pegarla otra vez al reiniciar la app. Ollama no necesita clave.
