# ArtFicha

ArtFicha es una herramienta para catalogar, revisar y publicar obras de arte en Todocoleccion con apoyo de IA. El flujo principal es:

1. Subir imagen.
2. Recortar/enderezar.
3. Generar ficha.
4. Revisar calidad humana.
5. Guardar borrador o publicar.

## Estado Actual

- Frontend: React + Vite + TypeScript.
- Backend: Supabase Edge Functions.
- Base de datos: Supabase Postgres con RLS por usuario.
- IA: Groq Vision opcional para autogiro/análisis premium.
- Publicación: integración con Todocoleccion.

## Requisitos

- Node.js 20 o superior.
- Proyecto Supabase configurado.
- Variables de entorno basadas en `.env.example`.

## Instalación Local

```bash
npm install
npm run dev
```

## Verificación

```bash
npm run lint
npm test
npm run build
```

## Seguridad

La app requiere autenticación antes de entrar. Las fichas se separan por `user_id` y las políticas RLS impiden leer, modificar o borrar datos de otros usuarios.

Las claves de Todocoleccion y Groq ya no se persisten en `localStorage`; se mantienen en sesión del navegador y la migración incluye tablas privadas para moverlas a backend por usuario. Para producción SaaS, el siguiente paso recomendado es que las Edge Functions lean esas claves desde backend y que el frontend nunca vuelva a recibirlas.

## Crear Cuenta Admin

Primero aplica las migraciones de Supabase, incluida la tabla `user_roles`. Después ejecuta:

```bash
npm run admin:create
```

Por defecto crea `admin@artficha.local` y genera una contraseña temporal que solo se imprime en consola. Para usar otro email:

```bash
ADMIN_EMAIL=tu-email@dominio.com npm run admin:create
```

En Windows PowerShell:

```powershell
$env:ADMIN_EMAIL="tu-email@dominio.com"
$env:SUPABASE_SERVICE_ROLE_KEY="tu-service-role-key"
npm run admin:create
```

No guardes `SUPABASE_SERVICE_ROLE_KEY` en código ni en archivos que vayan a Git.

## Flujo Recomendado

- En producto individual: generar ficha, revisar checklist, guardar y publicar.
- En lote: generar borradores primero, revisar y publicar seleccionados.
- El autopublicado por lote existe, pero exige confirmación explícita porque puede publicar fichas sin revisión pieza a pieza.

## Limitaciones Conocidas

- Las claves aún se introducen desde frontend y se mantienen en sesión.
- Falta facturación si se quiere vender como SaaS.
- Falta almacenamiento dedicado de imágenes en Supabase Storage.
- Falta monitorización externa de errores.
- Falta medición real con 50-100 imágenes para validar precisión del autogiro/recorte.
