
import os
import sys
import argparse
import base64
from openai import OpenAI

# Force output flushing to ensure logs appear immediately
sys.stdout.reconfigure(line_buffering=True)

def main():
    try:
        parser = argparse.ArgumentParser(description='Medical Report Editor')
        parser.add_argument('--file', required=True, help='Path to the markdown file to edit')
        parser.add_argument('--instruction', default=None, help='User instruction')
        parser.add_argument('--instruction_b64', default=None, help='User instruction (Base64 encoded)')
        args = parser.parse_args()

        instruction = args.instruction
        if args.instruction_b64:
            try:
                instruction = base64.b64decode(args.instruction_b64).decode('utf-8')
            except Exception as e:
                print(f"Error decoding base64 instruction: {e}")
                sys.exit(1)
                
        if not instruction:
            # Try reading from stdin
            if not sys.stdin.isatty():
                instruction = sys.stdin.read().strip()
        
        if not instruction:
            print("Error: No instruction provided (via arg, b64, or stdin)")
            sys.exit(1)

        if not os.path.exists(args.file):
            print(f"Error: File {args.file} not found.")
            sys.exit(1)

        try:
            with open(args.file, 'r', encoding='utf-8', errors='replace') as f:
                current_content = f.read()
        except Exception as e:
            print(f"Error reading file {args.file}: {e}")
            sys.exit(1)

        # Configuration
        API_KEY = "7832d9e6fe516de662053d96a0b6fdac1013fe201b914a2ab267858c21176d8d850c4ea2ce14ecac88ce31b02cbd54d34e9e4ba305227b5daed097527e3d7386w"
        BASE_URL = "http://ada01.ujaen.es:8080/v1"
        # UPDATED MODEL PATH (12b)
        MODEL_PATH = "/mnt/beegfs/sinai-data/google/gemma-3-12b-it"

        client = OpenAI(
            base_url=BASE_URL, 
            api_key=API_KEY
        )
        
        prompt = f"""Eres un editor médico experto ayudando a un doctor.
        
        TAREA: Modifica el Informe Médico de abajo basándote ESTRICTAMENTE en la INSTRUCCIÓN DEL USUARIO.
        
        INSTRUCCIÓN DEL USUARIO: "{instruction}"
        
        INFORME ACTUAL:
        {current_content}
        
        REGLAS DE SALIDA:
        1. Devuelve el informe actualizado COMPLETO.
        2. Mantén el formato Markdown exactamente.
        3. NO incluyas texto conversacional (como "Aquí está el informe actualizado"). Devuelve SOLO el contenido del informe.
        4. Mantén el tono profesional, en tercera persona y objetivo a menos que se pida explícitamente cambiarlo.
        """

        print(instruction)

        response = client.chat.completions.create(
            model=MODEL_PATH,
            messages=[
                {"role": "user", "content": prompt}
            ],
            max_tokens=4096,
            temperature=0.0
        )
        
        new_content = response.choices[0].message.content.strip()
        
        # Cleanup potential markdown code blocks
        if new_content.startswith("```markdown"):
            new_content = new_content.replace("```markdown", "", 1)
        if new_content.startswith("```"):
            new_content = new_content.replace("```", "", 1)
        if new_content.endswith("```"):
            new_content = new_content[:-3]
        
        new_content = new_content.strip()

        print(new_content)

        # Write back to file
        with open(args.file, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
        print("SUCCESS")

    except Exception as e:
        print(f"Error during editing: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
