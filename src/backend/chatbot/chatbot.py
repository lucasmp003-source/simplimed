#!/usr/bin/env python3
"""
Servidor persistente del chatbot RAG
Mantiene el modelo cargado y escucha peticiones continuamente
"""
import sys
import json
from openai import OpenAI
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
import PyPDF2
from typing import List, Dict
import pickle
import os
import time
import shutil

class RAGChatbot:
    def __init__(self, model_path: str, pdf_paths: List[str], prompt_template: str, chunk_size: int = 500, chunk_overlap: int = 50):
        """
        Inicializa el chatbot RAG con múltiples documentos
        """
        self.model_path = model_path
        self.prompt_template = prompt_template
        self.client = OpenAI(
            base_url="http://ada01.ujaen.es:8080/v1", 
            api_key=os.environ.get("OPENAI_API_KEY", "your-api-key-here")
        )
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
        self.conversations = {}  # Diccionario para almacenar historiales por conversación
        self.max_conversations = 100  # Límite de conversaciones activas
    
        
        print("🔧 Inicializando modelo de embeddings...", file=sys.stderr, flush=True)
        self.embedding_model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
        
        print("📚 Cargando y procesando documentos PDF...", file=sys.stderr, flush=True)
        self.chunks = []
        for pdf_path in pdf_paths:
            doc_chunks = self._load_and_chunk_pdf(pdf_path)
            self.chunks.extend(doc_chunks)
        
        print(f"✓ {len(self.chunks)} chunks extraídos", file=sys.stderr, flush=True)
        
        print("🔢 Creando embeddings...", file=sys.stderr, flush=True)
        self.embeddings = self._create_embeddings(self.chunks)
        
        print("🔍 Creando índice FAISS...", file=sys.stderr, flush=True)
        self.index = self._create_faiss_index(self.embeddings)
        
        print("✅ Chatbot inicializado y listo", file=sys.stderr, flush=True)
    
    
    def _cleanup_old_conversations(self):
        """Limpia conversaciones antiguas si superamos el límite"""
        if len(self.conversations) > self.max_conversations:
            # Ordenar por último uso y eliminar las más antiguas
            sorted_convs = sorted(
                self.conversations.items(), 
                key=lambda x: x[1].get('last_used', 0)
            )
            # Mantener solo las 80 más recientes
            for conv_id, _ in sorted_convs[:-80]:
                del self.conversations[conv_id]
                print(f"[CLEANUP] Conversación {conv_id} eliminada", file=sys.stderr, flush=True)
    
    
    def _load_and_chunk_pdf(self, pdf_path: str) -> List[Dict[str, any]]:
        """Carga el PDF y lo divide en chunks"""
        chunks = []
        doc_name = os.path.basename(pdf_path)
        
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            
            for page_num, page in enumerate(pdf_reader.pages):
                text = page.extract_text()
                
                start = 0
                while start < len(text):
                    end = start + self.chunk_size
                    chunk_text = text[start:end]
                    
                    if chunk_text.strip():
                        chunks.append({
                            'text': chunk_text,
                            'document': doc_name,
                            'page': page_num + 1,
                            'start_char': start
                        })
                    
                    start += self.chunk_size - self.chunk_overlap
        
        return chunks
    
    def _create_embeddings(self, chunks: List[Dict]) -> np.ndarray:
        """Crea embeddings para todos los chunks"""
        texts = [chunk['text'] for chunk in chunks]
        embeddings = self.embedding_model.encode(texts, show_progress_bar=False)
        return embeddings
    
    def _create_faiss_index(self, embeddings: np.ndarray) -> faiss.Index:
        """Crea un índice FAISS para búsqueda rápida"""
        dimension = embeddings.shape[1]
        index = faiss.IndexFlatL2(dimension)
        index.add(embeddings.astype('float32'))
        return index
    
    def _retrieve_relevant_chunks(self, query: str, k: int = 3) -> List[Dict]:
        """Recupera los k chunks más relevantes para la query"""
        query_embedding = self.embedding_model.encode([query])
        distances, indices = self.index.search(query_embedding.astype('float32'), k)
        
        relevant_chunks = []
        for idx in indices[0]:
            relevant_chunks.append(self.chunks[idx])
        
        return relevant_chunks
    
    def _build_prompt(self, query: str, context_chunks: List[Dict]) -> str:
        """Construye el prompt con el contexto recuperado"""
        context = "\n\n".join([
            f"[Documento: {chunk['document']} - Página {chunk['page']}]\n{chunk['text']}" 
            for chunk in context_chunks
        ])
        
        return self.prompt_template.replace("${CONTEXTO}", context).replace("${QUERY}", query)
    
    def chat(self, user_query: str, conversation_id: str = None, k_chunks: int = 3, max_tokens: int = 1024) -> str:
        """
        Procesa una consulta del usuario con historial de conversación
        
        Args:
            user_query: La pregunta del usuario
            conversation_id: ID único de la conversación (opcional, se crea uno si no existe)
            k_chunks: Número de chunks a recuperar
            max_tokens: Tokens máximos en la respuesta
        """
        # Si no hay conversation_id, crear uno nuevo
        if not conversation_id:
            conversation_id = f"conv_{int(time.time())}"
        
        # Recuperar contexto RAG
        relevant_chunks = self._retrieve_relevant_chunks(user_query, k=k_chunks)
        system_prompt = self._build_prompt(user_query, relevant_chunks)
        
        # Obtener o crear historial de conversación
        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = {
                'history': [],
                'created_at': time.time(),
                'last_used': time.time()
            }
            print(f"[CHAT] Nueva conversación creada: {conversation_id}", file=sys.stderr, flush=True)
        
        conversation = self.conversations[conversation_id]
        
        # Actualizar timestamp de último uso
        conversation['last_used'] = time.time()
        
        # Construir mensajes con historial
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(conversation['history'])  # 👈 Añadir historial
        messages.append({"role": "user", "content": user_query})
        
        print(f"[CHAT] Conversación {conversation_id} - {len(conversation['history'])//2} mensajes previos", 
              file=sys.stderr, flush=True)
        
        # Llamar al modelo
        response_stream = self.client.chat.completions.create(
            model=self.model_path,
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.0,
            stream=True
        )
        
        full_response = ""
        for chunk in response_stream:
            if chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                full_response += content
        
        # 👇 GUARDAR EN EL HISTORIAL
        conversation['history'].append({"role": "user", "content": user_query})
        conversation['history'].append({"role": "assistant", "content": full_response})
        
        # Limitar historial a últimos 10 intercambios (20 mensajes)
        if len(conversation['history']) > 20:
            conversation['history'] = conversation['history'][-20:]
        
        # Limpiar conversaciones antiguas
        self._cleanup_old_conversations()
        
        return full_response
    
    def clear_conversation(self, conversation_id: str):
        """Limpia el historial de una conversación específica"""
        if conversation_id in self.conversations:
            del self.conversations[conversation_id]
            print(f"[CHAT] Conversación {conversation_id} eliminada", file=sys.stderr, flush=True)
    
    def get_conversation_info(self, conversation_id: str) -> dict:
        """Obtiene información sobre una conversación"""
        if conversation_id in self.conversations:
            conv = self.conversations[conversation_id]
            return {
                'exists': True,
                'messages_count': len(conv['history']) // 2,
                'created_at': conv['created_at'],
                'last_used': conv['last_used']
            }
        return {'exists': False}
    
    def save_index(self, save_dir: str = "./rag_index"):
        """Guarda el índice y chunks para reutilizar"""
        os.makedirs(save_dir, exist_ok=True)
        faiss.write_index(self.index, f"{save_dir}/faiss.index")
        with open(f"{save_dir}/chunks.pkl", 'wb') as f:
            pickle.dump(self.chunks, f)
    
    @classmethod
    def load_index(cls, model_path: str, prompt_template: str, save_dir: str = "./rag_index"):
        """Carga un índice previamente guardado"""
        instance = cls.__new__(cls)
        instance.model_path = model_path
        instance.prompt_template = prompt_template
        instance.client = OpenAI(
            base_url="http://ada01.ujaen.es:8080/v1", 
            api_key=os.environ.get("OPENAI_API_KEY", "your-api-key-here")
        )
        
        instance.conversations = {}
        instance.max_conversations = 100
        
        print("🔧 Cargando modelo de embeddings...", file=sys.stderr, flush=True)
        instance.embedding_model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
        
        print("📂 Cargando índice FAISS...", file=sys.stderr, flush=True)
        instance.index = faiss.read_index(f"{save_dir}/faiss.index")
        
        print("📚 Cargando chunks...", file=sys.stderr, flush=True)
        with open(f"{save_dir}/chunks.pkl", 'rb') as f:
            instance.chunks = pickle.load(f)
        
        print(f"✅ Índice cargado ({len(instance.chunks)} chunks)", file=sys.stderr, flush=True)
        return instance


def initialize_chatbot():
    """Inicializa o carga el chatbot"""
    MODEL_PATH = "/mnt/beegfs/sinai-data/google/gemma-3-12b-it"
    PROMPT_PATH = "prompt.txt"
    SAVE_DIR = "./rag_index"
    
    try:
        # Cargar el prompt template
        with open(PROMPT_PATH, "r", encoding="utf-8") as f:
            prompt_template = f.read()
        
        # Intentar cargar un índice existente
        try:
            print("🔄 Intentando cargar índice existente...", file=sys.stderr, flush=True)
            return RAGChatbot.load_index(
                model_path=MODEL_PATH,
                prompt_template=prompt_template,
                save_dir=SAVE_DIR
            )
        except Exception as e:
            print(f"⚠️  No se pudo cargar índice: {e}", file=sys.stderr, flush=True)
            
            # Limpiar directorio corrupto si existe
            if os.path.exists(SAVE_DIR):
                print(f"🧹 Limpiando índice corrupto en {SAVE_DIR}...", file=sys.stderr, flush=True)
                shutil.rmtree(SAVE_DIR)

            print("🆕 Creando nuevo índice...", file=sys.stderr, flush=True)
            
            PDF_PATHS = ["tfg_anom_light.pdf"]
            valid_pdfs = []

            # Validar PDFs antes de procesar
            for pdf in PDF_PATHS:
                if not os.path.exists(pdf):
                    print(f"❌ Error: El archivo {pdf} no existe", file=sys.stderr, flush=True)
                    continue
                
                try:
                    # Intentar abrir para verificar corrupción
                    with open(pdf, 'rb') as f:
                        PyPDF2.PdfReader(f)
                    valid_pdfs.append(pdf)
                except Exception as pdf_err:
                    print(f"❌ Error: El archivo {pdf} está corrupto o no es válido: {pdf_err}", file=sys.stderr, flush=True)
            
            if not valid_pdfs:
                raise Exception("No hay documentos PDF válidos para indexar. Verifica 'tfg_anom_light.pdf'")

            chatbot = RAGChatbot(
                model_path=MODEL_PATH,
                pdf_paths=valid_pdfs,
                prompt_template=prompt_template,
                chunk_size=500,
                chunk_overlap=50
            )
            
            print("💾 Guardando índice para uso futuro...", file=sys.stderr, flush=True)
            chatbot.save_index(save_dir=SAVE_DIR)
            return chatbot
    except Exception as e:
        print(f"❌ ERROR_INIT: {str(e)}", file=sys.stderr, flush=True)
        sys.exit(1)


def main():
    """
    Función principal que mantiene el servidor activo
    Lee JSON desde stdin línea por línea y responde por stdout
    """
    print("🚀 Iniciando servidor persistente del chatbot...", file=sys.stderr, flush=True)
    
    # Inicializar el chatbot UNA VEZ
    chatbot = initialize_chatbot()
    
    print("✅ Servidor listo para recibir peticiones", file=sys.stderr, flush=True)
    print("📨 Esperando mensajes en formato JSON...", file=sys.stderr, flush=True)
    
    # Loop infinito para procesar peticiones
    while True:
        try:
            line = sys.stdin.readline()
            
            if not line:
                print("⚠️  stdin cerrado, finalizando servidor", file=sys.stderr, flush=True)
                break
            
            line = line.strip()
            if not line:
                continue
            
            # Parsear JSON
            try:
                data = json.loads(line)
                message = data.get('message', '').strip()
                conversation_id = data.get('conversation_id')  # 👈 NUEVO
                action = data.get('action', 'chat')  # 👈 NUEVO
            except json.JSONDecodeError as e:
                error_response = {
                    'error': 'JSON inválido',
                    'details': str(e)
                }
                print(json.dumps(error_response), flush=True)
                continue
            
            # 👇 MANEJAR DIFERENTES ACCIONES
            if action == 'clear':
                # Limpiar conversación
                if conversation_id:
                    chatbot.clear_conversation(conversation_id)
                    response = {
                        'status': 'success',
                        'message': 'Conversación limpiada',
                        'conversation_id': conversation_id
                    }
                else:
                    response = {
                        'error': 'conversation_id requerido para limpiar'
                    }
                print(json.dumps(response, ensure_ascii=False), flush=True)
                continue
            
            elif action == 'info':
                # Obtener info de conversación
                if conversation_id:
                    info = chatbot.get_conversation_info(conversation_id)
                    response = {
                        'status': 'success',
                        'conversation_id': conversation_id,
                        'info': info
                    }
                else:
                    response = {
                        'error': 'conversation_id requerido'
                    }
                print(json.dumps(response, ensure_ascii=False), flush=True)
                continue
            
            elif action == 'edit':
                # Edición de informe existente
                if not conversation_id or not message:
                    response = {
                        'error': 'conversation_id y message requeridos para editar'
                    }
                else:
                    try:
                        # 1. Leer el archivo original
                        # Asumimos que conversation_id es el token/nombre del archivo
                        # Buscamos en data/OutputData tanto .md como .txt si fuera necesario
                        base_path = "data/OutputData"
                        file_path = f"{base_path}/{conversation_id}.md"
                        
                        # Si no existe md, intentar buscar sin extensión si el ID ya la trae
                        if not os.path.exists(file_path) and conversation_id.endswith('.md'):
                             file_path = f"{base_path}/{conversation_id}"

                        if not os.path.exists(file_path):
                             response = {'error': f'Archivo no encontrado: {file_path}'}
                             print(f"❌ Error: Archivo no encontrado en {file_path}", file=sys.stderr, flush=True)
                        else:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                current_content = f.read()

                            # 2. Construir prompt para edición
                            # Usamos el cliente OpenAI ya inicializado en chatbot
                            
                            system_content = (
                                "Eres un asistente médico experto encargado de corregir y modificar informes clínicos. "
                                "Tu tarea es modificar el siguiente informe según las instrucciones del usuario. "
                                "Mantén el formato Markdown del informe original. "
                                "NO expliques los cambios, solo devuelve el informe modificado completo."
                            )
                            
                            user_content = f"INSTRUCCIÓN: {message}\n\nINFORME ORIGINAL:\n{current_content}"
                            
                            print(f"[EDIT] Procesando edición para {conversation_id}...", file=sys.stderr, flush=True)

                            # 3. Llamar al LLM
                            client = chatbot.client
                            completion = client.chat.completions.create(
                                model=chatbot.model_path,
                                messages=[
                                    {"role": "system", "content": system_content},
                                    {"role": "user", "content": user_content}
                                ],
                                max_tokens=4096,
                                temperature=0.2
                            )
                            
                            new_content = completion.choices[0].message.content
                            
                            # 4. Guardar el resultado sobreescribiendo
                            with open(file_path, 'w', encoding='utf-8') as f:
                                f.write(new_content)
                                
                            response = {
                                'status': 'success',
                                'message': 'Informe actualizado correctamente',
                                'conversation_id': conversation_id,
                                'response': "✅ Informe actualizado correctamente."
                            }
                            print(f"[EDIT] Edición completada para {conversation_id}", file=sys.stderr, flush=True)

                    except Exception as e:
                        print(f"❌ Error en edición: {str(e)}", file=sys.stderr, flush=True)
                        response = {'error': f'Error procesando edición: {str(e)}'}

                print(json.dumps(response, ensure_ascii=False), flush=True)
                continue
            
            # Acción por defecto: chat
            if not message:
                error_response = {
                    'error': 'Mensaje vacío'
                }
                print(json.dumps(error_response), flush=True)
                continue
            
            print(f"📩 Procesando consulta (conv: {conversation_id}): {message[:50]}...", 
                  file=sys.stderr, flush=True)
            
            # Procesar el mensaje con historial
            response_text = chatbot.chat(message, conversation_id=conversation_id)
            
            # Enviar respuesta como JSON
            response = {
                'response': response_text,
                'status': 'success',
                'conversation_id': conversation_id  # 👈 Devolver el ID
            }
            print(json.dumps(response, ensure_ascii=False), flush=True)
            
            print("✓ Respuesta enviada", file=sys.stderr, flush=True)
            
        except Exception as e:
            print(f"❌ Error procesando petición: {str(e)}", file=sys.stderr, flush=True)
            error_response = {
                'error': 'Error interno',
                'details': str(e)
            }
            print(json.dumps(error_response), flush=True)
            
            
if __name__ == "__main__":
    main()