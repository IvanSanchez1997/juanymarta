# Instrucciones para el AppScript - Nuevo campo: Autobús por adulto

## Resumen del cambio
Se ha agregado una pregunta sobre autobús **para cada adulto** en el formulario RSVP. 

La pregunta es simple: **"¿Necesita autobús?"** con opciones **Sí** o **No**.

Este campo aparece dentro de la tarjeta de cada adulto cuando el usuario confirma asistencia.

---

## Datos que se envían ahora

El objeto JSON que llega al AppScript ahora incluye un nuevo campo por cada adulto:

```javascript
{
  "asiste": "Sí",
  "totalAdultos": 2,
  "adulto1_nombre": "Juan Pérez",
  "adulto1_alergia": "Ninguna",
  "adulto1_autobus": "Sí",        // ← NUEVO CAMPO para adulto 1
  "adulto2_nombre": "María García",
  "adulto2_alergia": "Gluten",
  "adulto2_autobus": "No",        // ← NUEVO CAMPO para adulto 2
  "comentarios": "Llegamos sobre las 12:00",
  "timestamp": "2026-09-10T14:32:00.000Z"
}
```

### Campos nuevos:
- **`adulto1_autobus`**: "Sí" o "No"
- **`adulto2_autobus`**: "Sí" o "No"
- **`adulo3_autobus`**: "Sí" o "No"
- ... (tantos como adultos confirmen)

---

## Cambios requeridos en el AppScript

Debes actualizar tu Google Sheets y tu AppScript para:

### 1. Agregar columnas en Google Sheets
En la hoja de cálculo, por cada adulto necesitas capturar el autobús. Recomendaciones:
- Opción A: Una columna por adulto: `Adulto 1 - Autobús`, `Adulto 2 - Autobús`, etc.
- Opción B: Una sola columna que contenga los datos concatenados: "Adulto 1: Sí, Adulto 2: No"

### 2. Actualizar el código del AppScript

En tu función que procesa los datos POST, debes capturar los campos de autobús:

```javascript
// Ejemplo de cómo tu código probablemente luce:
function doPost(e) {
  const datos = JSON.parse(e.postData.contents);
  
  // Tu código existente...
  // Ahora agrega estas líneas para capturar el autobús de cada adulto:
  
  const totalAdultos = datos.totalAdultos;
  const autobusData = [];
  
  for (let i = 1; i <= totalAdultos; i++) {
    const autobus = datos['adulto' + i + '_autobus'] || "—";
    autobusData.push(autobus);
  }
  
  // Luego, cuando escribas en la hoja, agrupa los datos:
  // Opción A: Columnas separadas
  sheet.appendRow([
    datos.asiste,
    datos.totalAdultos,
    datos.adulto1_nombre,
    datos.adulto1_alergia,
    datos.adulto1_autobus,    // ← Autobús del adulto 1
    datos.adulto2_nombre,
    datos.adulto2_alergia,
    datos.adulto2_autobus,    // ← Autobús del adulto 2
    // ... y así sucesivamente
    datos.comentarios,
    datos.timestamp
  ]);
  
  // O Opción B: Una sola columna concatenada
  const autobusResumen = autobusData.join(', ');
  sheet.appendRow([
    datos.asiste,
    datos.totalAdultos,
    datos.adulto1_nombre,
    datos.adulto1_alergia,
    // ... datos de otros adultos ...
    datos.comentarios,
    autobusResumen,    // ← "Sí, No" (concatenado)
    datos.timestamp
  ]);
}
```

---

## Notas importantes

### ✅ Lo que SIEMPRE se envía:
- Cuando el usuario elige **"¡Allí estaré!"**: Se incluye `aduloX_autobus` para CADA adulto (Sí o No)
- Cada adulto DEBE responder si necesita autobús antes de poder enviar
- Cuando el usuario elige **"No podré ir"**: El campo `aduloX_autobus` **NO aparece** (porque la pregunta solo sale en la sección de "Sí")

### ✅ Validación en el formulario:
- El formulario valida que cada adulto DEBE seleccionar si necesita autobús
- Si alguien no elige, mostrará un alert: *"Indica si el adulto 2 necesita autobús."*

### ✅ Estructura del formulario mantenida:
- La pregunta está dentro de cada tarjeta de adulto
- Es simple: solo Sí/No sin iconos
- Los estilos se alinean con el formulario existente

---

## Resumen visual del formulario actualizado

```
┌─ ¿Vas a asistir?
│  [¥ ¡Allí estaré!]  [💌 No podré ir]
│
└─ (Si elige "SÍ")
   ├─ Número de adultos
   │  [Dropdown: 1-10 adultos]
   │
   ├─ [Adulto principal]
   │  ├─ Nombre: [_______________]
   │  ├─ Alergias: [_______________]
   │  └─ ¿Necesita autobús?       ← NUEVA PREGUNTA AQUÍ
   │     [ ✓ Sí ]  [ No ]
   │
   ├─ [Adulto 2]
   │  ├─ Nombre: [_______________]
   │  ├─ Alergias: [_______________]
   │  └─ ¿Necesita autobús?       ← NUEVA PREGUNTA AQUÍ
   │     [ Sí ]  [ ✓ No ]
   │
   ├─ Comentarios o notas especiales
   │  [Textarea]
   │
   └─ [✦ Confirmar asistencia ✦]
```

---

## Pruebas recomendadas

1. **Prueba con 1 adulto**: Confirma "Allí estaré" con 1 adulto y selecciona "Sí" para autobús. Verifica que `adulo1_autobus: "Sí"` aparece en Sheets.
2. **Prueba con 3 adultos**: Confirma "Allí estaré" con 3 adultos. Selecciona diferentes opciones (Sí, No, Sí). Verifica que aparecen `adulo1_autobus: "Sí"`, `adulo2_autobus: "No"`, `adulo3_autobus: "Sí"`
3. **Valida que sea obligatorio**: Intenta enviar sin seleccionar autobús → debe mostrar alert
4. **Prueba "No asiste"**: Envía "No podré ir" → verifica que NO aparezcan campos de autobús

---

## Preguntas frecuentes

**P: ¿Qué pasa si alguien envía un formulario antiguo sin el campo?**
- R: Tu validación debería manejar esto con `|| "—"` para asignar un valor por defecto

**P: ¿Puedo cambiar "¿Necesita autobús?" por otra pregunta?**
- R: Sí, está en el código JavaScript dentro de `_generarAdultos()`. Busca el texto y modifícalo directamente.

**P: ¿Debo cambiar la URL del AppScript?**
- R: No, es la misma. Solo debes actualizar el procesamiento de datos en tu código.

**P: ¿Cómo sé cuántos adultos respondieron a la pregunta de autobús?**
- R: Usa `datos.totalAdultos` para saber cuántos adultos hay, y luego itera de 1 a ese número.

---

Cualquier duda, pregunta. ¡Que funcione bien! 🎉
