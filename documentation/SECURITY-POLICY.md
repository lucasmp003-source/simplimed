# Política de Seguridad de Dependencias

## Niveles de Severidad y Respuesta

| Severidad | Tiempo de Respuesta | Acción |
|-----------|---------------------|--------|
| **Critical** | 24 horas | Parchear inmediatamente, deploy de emergencia |
| **High** | 7 días | Parchear en próximo sprint, testing completo |
| **Moderate** | 30 días | Evaluar impacto, planificar actualización |
| **Low** | 90 días | Actualizar en mantenimiento rutinario |

## Proceso de Actualización

1. **Detectar**: Dependabot/Snyk crea issue automático
2. **Evaluar**: Revisar changelog y breaking changes
3. **Testear**: Ejecutar suite de tests en rama separada
4. **Aprobar**: Code review + security review
5. **Desplegar**: Merge a main + deploy

## Contacto

- Responsable de seguridad: [tu-email]@ujaen.es
- Issues de seguridad: usar GitHub Security Advisories
