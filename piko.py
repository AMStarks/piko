"""Interactive REPL to vLLM on RunPod via local SSH tunnel (e.g. -L 18000:127.0.0.1:8000)."""

from openai import OpenAI

# Setup the client to point to your SSH tunnel
client = OpenAI(
    base_url="http://localhost:18000/v1",
    api_key="EMPTY",
)

MODEL = "Qwen/Qwen2.5-72B-Instruct-AWQ"

# Initialize conversation history with the system prompt
messages = [
    {
        "role": "system",
        "content": "You are Piko, a brilliant, highly capable, and slightly witty AI assistant. Keep your answers clear, concise, and engaging.",
    },
]

print("=== Piko is online! (Type 'quit' or 'exit' to stop) ===\n")

while True:
    user_input = input("You: ")
    if user_input.lower() in ["quit", "exit", "q"]:
        print("Piko: Catch you later!")
        break

    # Add what you typed to the memory
    messages.append({"role": "user", "content": user_input})

    print("Piko: ", end="", flush=True)

    try:
        # Send to RunPod and stream the response
        stream = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            stream=True,
        )

        assistant_reply = ""
        for chunk in stream:
            if chunk.choices[0].delta.content is not None:
                text = chunk.choices[0].delta.content
                print(text, end="", flush=True)
                assistant_reply += text

        print("\n")

        # Add Piko's reply to the memory so it remembers for the next question
        messages.append({"role": "assistant", "content": assistant_reply})

    except Exception as e:
        print(f"\n[Connection Error] Make sure your SSH tunnel is running! Details: {e}\n")
