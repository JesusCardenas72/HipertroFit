# Desplegar HipertroFit en una VM gratuita con HTTPS

Guía para poner en internet el `docker-compose.yml` de este repositorio, sin cambiar código, y
tener el mismo usuario sincronizado en el PC, en el navegador del móvil y en la APK.

```
 Móvil (APK / PWA) ─┐                       Google Cloud e2-micro (Debian 12)
 PC (navegador)  ───┼── HTTPS ──► Caddy :443 ──► web :8080 (nginx) ──► api :3000
                    │            (Let's Encrypt)       │                    │
                    └── DNS: tugym.duckdns.org         └── /api ────────────┘
                                                               ./data  ← tus datos (copia de seguridad)
```

- **Proveedor:** Google Cloud, nivel *Always Free*. Al final hay notas para Oracle Cloud.
- **Dominio:** DuckDNS, que es gratuito.
- **HTTPS:** Caddy, que pide y renueva el certificado solo.
- **Tiempo estimado:** 45–60 min, de los que unos 15–20 son la primera compilación.

> Revisa las condiciones del nivel gratuito antes de empezar, porque cambian. Lo que sigue
> responde a cómo funcionaban cuando se escribió la guía. Crea siempre la **alerta de
> presupuesto** del paso 1: así te enteras si algo empieza a costar dinero.

---

## 0. Antes de empezar: copia de seguridad de tus datos

En cada dispositivo que tenga datos (sobre todo el móvil), abre **Ajustes → Exportar copia (JSON)**
y guarda el fichero en un sitio seguro. La sincronización está pensada para no perder nada,
pero así tienes una red de seguridad.

---

## 1. Cuenta de Google Cloud y alerta de presupuesto

1. Entra en <https://console.cloud.google.com/>, acepta las condiciones y activa la facturación.
   Pide una tarjeta, pero los recursos del nivel *Always Free* no se cobran.
2. Crea un proyecto, por ejemplo `hipertrofit`.
3. Ve a **Facturación → Presupuestos y alertas → Crear presupuesto**. Pon 1 € y activa los avisos
   por correo al 50 %, al 90 % y al 100 %.

---

## 2. Crear la máquina virtual

**Compute Engine → Instancias de VM → Crear instancia** (la primera vez te pedirá activar la
API de Compute Engine):

| Campo | Valor | Por qué |
|---|---|---|
| Nombre | `hipertrofit` | — |
| Región | `us-central1`, `us-west1` o `us-east1` | Son las únicas regiones del nivel gratuito |
| Tipo de máquina | **E2 → e2-micro** (2 vCPU compartidas, 1 GB) | Es la máquina gratuita |
| Disco de arranque | **Debian 12**, tipo **Disco persistente estándar**, **30 GB** | El disco "equilibrado", que sale por defecto, **no** es gratuito |
| Cortafuegos | ✅ Permitir tráfico HTTP · ✅ Permitir tráfico HTTPS | Caddy necesita el 80 para el certificado y el 443 para servir la app |

Pulsa **Crear**. Cuando esté en marcha, apunta la **IP externa**.

> **La IP externa.** La que se asigna por defecto es *efímera*: no cambia mientras la VM esté
> encendida, pero puede cambiar si la paras y la vuelves a arrancar. El paso 4 deja un actualizador
> de DuckDNS que lo resuelve solo. Si prefieres una IP fija, en **Red de VPC → Direcciones IP**
> puedes convertirla en estática. Comprueba antes en la calculadora de precios si eso tiene coste
> en tu caso.

---

## 3. Conectarte a la VM

Desde la consola: botón **SSH** junto a la instancia, que abre un terminal en el navegador.
También puedes usar la CLI `gcloud compute ssh hipertrofit --zone <tu-zona>`. A partir de aquí,
todo se ejecuta **dentro de la VM**.

### 3.1 Memoria de intercambio (imprescindible en la e2-micro)

Compilar el frontend con 1 GB de RAM se queda sin memoria. Añade 2 GB de swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h    # debe aparecer Swap: 2.0Gi
```

### 3.2 Docker

Usa el repositorio oficial de Docker para Debian:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Cierra la ventana SSH y abre otra para que se aplique el grupo `docker`. Después comprueba:

```bash
docker compose version
```

---

## 4. Nombre de dominio con DuckDNS

1. Entra en <https://www.duckdns.org/> con tu cuenta de Google o GitHub.
2. Crea un subdominio, por ejemplo `tugym` (quedará `tugym.duckdns.org`), y pon la IP externa de
   la VM.
3. Copia el **token** que aparece arriba.

En la VM, deja un actualizador que corrija la IP si cambia:

```bash
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh <<'EOF'
#!/bin/sh
curl -fsS "https://www.duckdns.org/update?domains=TUGYM&token=TU_TOKEN&ip=" -o ~/duckdns/duck.log
EOF
chmod 700 ~/duckdns/duck.sh
nano ~/duckdns/duck.sh         # sustituye TUGYM y TU_TOKEN
~/duckdns/duck.sh && cat ~/duckdns/duck.log    # debe imprimir OK
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
```

Comprueba desde tu PC que el nombre ya responde con la IP correcta (`nslookup tugym.duckdns.org`).

> En el resto de la guía, sustituye `tugym.duckdns.org` por tu dominio.

---

## 5. Descargar HipertroFit

```bash
cd ~
git clone https://github.com/JesusCardenas72/HipertroFit.git
cd HipertroFit
```

Si el repositorio es privado, GitHub te pedirá usuario y un *personal access token* (de solo
lectura) en lugar de la contraseña.

### 5.1 Usar tus propias imágenes, no las de openGym

El `docker-compose.yml` apunta a las imágenes publicadas por openGym
(`registry.gitlab.com/duartesantos8/opengym/...`), que **no llevan tus cambios de HipertroFit**.
Crea un *override* que les cambie el nombre para compilarlas siempre desde tu código:

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  api:
    image: hipertrofit-api:local
  web:
    image: hipertrofit-web:local
EOF
```

> ⚠️ En esta VM **no ejecutes nunca `docker compose pull`**: si lo haces, compose intentará
> descargar imágenes que no existen o que no son las tuyas.

### 5.2 Imágenes y GIF de ejercicios desde la CDN (ahorra tráfico de salida)

El nivel gratuito incluye muy poco tráfico de salida al mes (del orden de 1 GB), y los GIF de
ejercicios pesan unos 140 MB. Para no gastarlo, haz lo mismo que la APK: que el navegador los
descargue de jsDelivr en lugar de tu VM. Vite lee este fichero al compilar, y git lo ignora
(`.env.*.local`):

```bash
cat > frontend/.env.production.local <<'EOF'
VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/
VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/
EOF
```

Son las mismas URL que usa `npm run build:mobile` en `frontend/package.json`. El servicio `media`
seguirá descargando la copia local una vez (el tráfico de *entrada* es gratuito), pero nadie la
servirá.

---

## 6. Configuración (`.env`)

```bash
cp .env.example .env
nano .env
```

Deja estas líneas así, con tu dominio. Las demás pueden quedarse como comentarios:

```bash
RP_ID=tugym.duckdns.org
ORIGIN=https://tugym.duckdns.org
RP_NAME=HipertroFit
# Solo escucha en la propia VM: desde fuera se entra únicamente por Caddy (HTTPS).
WEB_PORT=127.0.0.1:8080
# Opcional: avisos push con tu correo de contacto
# VAPID_SUBJECT=mailto:tu@correo.com
```

- `RP_ID` es solo el nombre, sin `https://` ni barra final. `ORIGIN` es la URL completa. Las
  passkeys quedan atadas a ese nombre exacto: **si cambias el dominio más adelante, las passkeys
  creadas dejarán de servir.** Elige bien el nombre ahora.
- `WEB_PORT=127.0.0.1:8080` hace que compose publique el puerto solo en local. El cortafuegos de
  Google ya bloquea el 8080, pero así hay doble protección.

---

## 7. Compilar y arrancar

```bash
docker compose up -d --build
```

La primera vez tarda entre 15 y 20 minutos en la e2-micro: compila el frontend y descarga los
medios. Al terminar, comprueba:

```bash
docker compose ps                          # api y web "running", media "exited (0)"
curl -s http://127.0.0.1:8080/api/health   # {"ok":true,...}
```

Si la compilación falla con `Killed` o `exit code 137`, se ha quedado sin memoria: revisa que el
swap esté activo (`free -h`).

---

## 8. HTTPS con Caddy

Instala Caddy desde su repositorio oficial:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

Configúralo:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
tugym.duckdns.org {
    encode gzip
    reverse_proxy 127.0.0.1:8080
}
EOF
sudo nano /etc/caddy/Caddyfile     # pon tu dominio
sudo systemctl reload caddy
sudo journalctl -u caddy -n 30     # debe decir "certificate obtained successfully"
```

Abre **https://tugym.duckdns.org** en el PC. Deberías ver la pantalla de inicio de HipertroFit con
el candado.

---

## 9. Crear tu perfil y cerrar la puerta

1. En el **PC**, en `https://tugym.duckdns.org`, crea tu perfil con passkey (Windows Hello, la
   llave del móvil, etc.).
   - Si ese navegador ya tenía datos de HipertroFit, se suben al perfil nuevo.
   - Si estaba vacío, el perfil queda vacío y los datos del móvil se subirán al emparejarlo
     (paso 10).
2. Hazte administrador. Busca tu id de usuario:
   ```bash
   sudo grep -o '"id":"[^"]*"' data/db.json | head -1
   ```
3. Añade al `.env`:
   ```bash
   ADMIN_UIDS=tu_id
   INVITE_ONLY=1      # nadie más puede crear perfiles sin un código tuyo
   ALLOW_GUEST=0      # opcional: quita "Continuar sin cuenta" en la web
   ```
4. Aplica los cambios: `docker compose up -d`. Recrea el `api` sin recompilar.

---

## 10. Conectar el móvil

### APK de HipertroFit (recomendado)

1. En el **PC** con la sesión abierta: **Ajustes → Emparejar la app móvil**. Aparece la dirección
   y un código válido durante 5 minutos.
2. En la **app del móvil**: **Ajustes → Conectar a mi servidor**. Introduce
   `https://tugym.duckdns.org` y el código.
3. Al conectar se comparan las dos copias: si el servidor está vacío o es más antiguo, **se suben
   los datos del móvil**; si el servidor tiene datos más recientes, se descargan al móvil.

A partir de ahí, cada cambio se sube unos 1,5 s después. Si no hay conexión, la app guarda los
cambios en local y los sube cuando vuelve la red.

### Navegador del móvil (PWA)

Abre `https://tugym.duckdns.org`, inicia sesión con tu passkey e instálala con *Añadir a pantalla
de inicio*.

> **Usa un dispositivo cada vez.** La sincronización sube el estado completo y gana la escritura
> más reciente. Si editas en el PC y en el móvil a la vez, sin conexión entre medias, al
> reconectar una versión pisará a la otra.

---

## 11. Copias de seguridad

Todo está en `~/HipertroFit/data`. Haz una copia diaria y conserva las últimas 14:

```bash
mkdir -p ~/backups
cat > ~/backups/backup.sh <<'EOF'
#!/bin/sh
cd ~/HipertroFit && sudo tar czf ~/backups/hipertrofit-$(date +%F).tar.gz data/ && sudo chown $USER ~/backups/*.tar.gz
ls -1t ~/backups/hipertrofit-*.tar.gz | tail -n +15 | xargs -r rm --
EOF
chmod 700 ~/backups/backup.sh
(crontab -l 2>/dev/null; echo "30 4 * * * ~/backups/backup.sh >/dev/null 2>&1") | crontab -
```

Una copia guardada solo en la misma VM no te protege si pierdes la VM. De vez en cuando
descárgala a tu PC:

```bash
gcloud compute scp hipertrofit:~/backups/hipertrofit-*.tar.gz . --zone <tu-zona>
```

También puedes descargar el archivo desde el menú ⚙ de la ventana SSH del navegador.
Además, **Ajustes → Exportar copia (JSON)** sigue funcionando en cualquier dispositivo.

**Para restaurar:** `docker compose down`, descomprime el `.tar.gz` dentro de `~/HipertroFit` y
ejecuta `docker compose up -d`.

---

## 12. Actualizar a una versión nueva

Cuando subas cambios a GitHub:

```bash
cd ~/HipertroFit
git pull
docker compose up -d --build
docker image prune -f      # libera el disco de imágenes viejas
```

`./data`, `.env`, `docker-compose.override.yml` y `frontend/.env.production.local` no se tocan al
actualizar.

---

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| No aparece el aviso de la passkey | Entras por `http://`, por IP o por un nombre distinto de `RP_ID`. Usa exactamente `https://tugym.duckdns.org` |
| Caddy no obtiene el certificado | El DNS aún no apunta a la VM, o faltan las reglas HTTP/HTTPS del cortafuegos (paso 2) |
| La compilación termina en `Killed` / 137 | Falta memoria: activa el swap (3.1) |
| `502 Bad Gateway` | Los contenedores no están arrancados: `docker compose ps` y `docker compose logs -f api web` |
| Los GIF no cargan | Revisa `frontend/.env.production.local` y recompila con `docker compose up -d --build` |
| El móvil dice que el código ha caducado | Dura 5 minutos: genera otro en el PC |
| Te llega un aviso de presupuesto | Revisa en Facturación qué se cobra: disco "equilibrado", región no gratuita, IP estática o tráfico de salida |

---

## Alternativa: Oracle Cloud Always Free

Si la e2-micro se te queda corta, el nivel gratuito de Oracle ofrece una VM **Ampere (ARM)** con
mucha más memoria. La guía es la misma con estos cambios:

- Imagen: Ubuntu 22.04/24.04 (cambia `debian` por `ubuntu` en las URL de Docker del paso 3.2), y
  el paso 3.1 (swap) sobra.
- Abre los puertos 80 y 443 en **dos sitios**: en la *Security List* de la VCN y en el cortafuegos
  de la propia VM (`sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT` y
  `sudo netfilter-persistent save`).
- El tráfico de salida gratuito es mucho mayor, así que el paso 5.2 es opcional.
- Oracle puede reclamar las instancias gratuitas que pasan mucho tiempo inactivas. Mantén las
  copias del paso 11 fuera de la VM.
