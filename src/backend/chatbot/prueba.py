from openai import OpenAI
import json

def test_llm_connection():
    """
    Prueba la conexión con el servidor LLM
    """
    print("="*70)
    print("🧪 TEST DE CONEXIÓN CON EL SERVIDOR LLM")
    print("="*70)
    
    # Configuración
    base_url = "http://ada01.ujaen.es:8080/v1"
    api_key = "7832d9e6fe516de662053d96a0b6fdac1013fe201b914a2ab267858c21176d8d850c4ea2ce14ecac88ce31b02cbd54d34e9e4ba305227b5daed097527e3d7386w"
    model_path = "/mnt/beegfs/sinai-data/google/gemma-3-12b-it"
    
    print(f"\n📡 Servidor: {base_url}")
    print(f"🤖 Modelo: {model_path}")
    print("-"*70)
    
    # Texto de prueba
    test_text = """
    La inteligencia artificial es un campo de la informática que se centra 
    en crear sistemas capaces de realizar tareas que normalmente requieren 
    inteligencia humana. Estos sistemas pueden aprender, razonar y resolver 
    problemas de manera autónoma.
    """
    
    # Prompt simple
    prompt = f"""Analiza el siguiente texto y responde SOLO con un JSON en este formato:
{{"idioma": "español" o "inglés", "tema": "breve descripción"}}

TEXTO:
{test_text}

JSON:"""
    
    print("\n📝 Enviando prompt de prueba...")
    print(f"Texto: {test_text.strip()[:100]}...")
    
    try:
        # Crear cliente
        client = OpenAI(base_url=base_url, api_key=api_key)
        
        print("\n⏳ Esperando respuesta del servidor...")
        
        # Hacer petición
        response = client.chat.completions.create(
            model=model_path,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0.0,
            stream=False
        )
        
        # Extraer respuesta
        response_text = response.choices[0].message.content.strip()
        
        print("\n✅ CONEXIÓN EXITOSA!")
        print("-"*70)
        print("📥 Respuesta del modelo:")
        print(response_text)
        print("-"*70)
        
        # Intentar parsear JSON
        try:
            # Limpiar respuesta
            clean_response = response_text
            if '```json' in clean_response:
                clean_response = clean_response.split('```json')[1].split('```')[0]
            elif '```' in clean_response:
                clean_response = clean_response.split('```')[1].split('```')[0]
            
            start = clean_response.find('{')
            end = clean_response.rfind('}')
            if start != -1 and end != -1:
                clean_response = clean_response[start:end+1]
            
            result = json.loads(clean_response)
            print("\n✅ JSON válido parseado:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            
        except json.JSONDecodeError as e:
            print(f"\n⚠️ No se pudo parsear como JSON: {e}")
        
        return True
        
    except Exception as e:
        print("\n❌ ERROR DE CONEXIÓN")
        print("-"*70)
        print(f"Tipo de error: {type(e).__name__}")
        print(f"Mensaje: {str(e)}")
        print("-"*70)
        
        # Sugerencias según el error
        error_str = str(e).lower()
        
        if "404" in error_str or "not found" in error_str:
            print("\n💡 POSIBLES SOLUCIONES:")
            print("1. El endpoint /v1/chat/completions no existe")
            print("2. Prueba cambiar base_url a:")
            print("   - http://ada01.ujaen.es:8080")
            print("   - http://ada01.ujaen.es:8080/api/v1")
            print("3. Verifica que el servicio esté corriendo")
            print("4. Contacta al administrador del servidor")
            
        elif "connection" in error_str or "timeout" in error_str:
            print("\n💡 POSIBLES SOLUCIONES:")
            print("1. Verifica que el servidor esté accesible")
            print("2. Comprueba tu conexión de red")
            print("3. El servicio puede estar caído")
            
        elif "401" in error_str or "403" in error_str:
            print("\n💡 POSIBLES SOLUCIONES:")
            print("1. Verifica que la API key sea correcta")
            print("2. Puede que no tengas permisos")
            
        return False


def test_alternative_endpoints():
    """
    Prueba endpoints alternativos comunes
    """
    print("\n" + "="*70)
    print("🔍 PROBANDO ENDPOINTS ALTERNATIVOS")
    print("="*70)
    
    api_key = "7832d9e6fe516de662053d96a0b6fdac1013fe201b914a2ab267858c21176d8d850c4ea2ce14ecac88ce31b02cbd54d34e9e4ba305227b5daed097527e3d7386w"
    model_path = "/mnt/beegfs/sinai-data/google/gemma-3-12b-it"
    
    # Lista de endpoints a probar
    endpoints = [
        "http://ada01.ujaen.es:8080/v1",
        "http://ada01.ujaen.es:8080",
        "http://ada01.ujaen.es:8080/api/v1",
        "http://ada01.ujaen.es:8080/api",
    ]
    
    for endpoint in endpoints:
        print(f"\n🧪 Probando: {endpoint}")
        print("-"*70)
        
        try:
            client = OpenAI(base_url=endpoint, api_key=api_key)
            
            response = client.chat.completions.create(
                model=model_path,
                messages=[{"role": "user", "content": "Di 'hola' en JSON: {\"saludo\": \"...\"}"}],
                max_tokens=50,
                temperature=0.0,
                stream=False,
                timeout=10.0
            )
            
            print(f"✅ FUNCIONA! Respuesta: {response.choices[0].message.content[:100]}")
            return endpoint
            
        except Exception as e:
            error_msg = str(e)[:150]
            print(f"❌ Falló: {error_msg}")
    
    print("\n❌ Ningún endpoint funcionó")
    return None


if __name__ == "__main__":
    # Test principal
    success = test_llm_connection()
    
    # Si falla, probar endpoints alternativos
    if not success:
        print("\n" + "="*70)
        working_endpoint = test_alternative_endpoints()
        
        if working_endpoint:
            print(f"\n✅ Endpoint funcional encontrado: {working_endpoint}")
            print(f"\nActualiza tu código con:")
            print(f'base_url="{working_endpoint}"')