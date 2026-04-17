"""Quick check that vLLM on RunPod is reachable via local SSH tunnel (e.g. -L 18000:127.0.0.1:8000)."""

from openai import OpenAI

# Point the client to your local SSH tunnel!
# vLLM doesn't need a real API key, so we just use "EMPTY"
client = OpenAI(
    base_url="http://localhost:18000/v1",
    api_key="EMPTY",
)

print("Sending message to RunPod...")

completion = client.chat.completions.create(
    model="Qwen/Qwen2.5-72B-Instruct-AWQ",
    messages=[
        {"role": "system", "content": "You are Piko's brain. Keep it to one sentence."},
        {"role": "user", "content": "What is the best thing about having a 48GB GPU?"},
    ],
)

print("\nAI Response:")
print(completion.choices[0].message.content)
