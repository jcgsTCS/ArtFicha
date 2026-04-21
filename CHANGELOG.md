# Changelog

## 2026-04-20

- Añadida autenticación obligatoria antes de usar ArtFicha.
- Añadida migración de seguridad con `user_id`, RLS privada, índices y tablas operativas.
- Eliminadas políticas públicas peligrosas en nueva migración.
- Cambiado el guardado de claves de `localStorage` a `sessionStorage`.
- Añadido `.gitignore` real y `.env.example`.
- Bloqueado el modo lote para que por defecto genere borradores; autopublicar exige confirmación explícita.
- Añadida validación de payloads con Zod.
- Añadidos tests reales de calidad, validación, autogiro y rotación de APIs.
- Mejorada la puntuación de calidad para penalizar títulos/descripciones genéricas.
- Añadida documentación de instalación y checklist de despliegue.
- Añadida migración de roles admin y script seguro `npm run admin:create`.
