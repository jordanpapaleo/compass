"""
Use Compass from Python with the official OpenAI SDK.

    pip install openai
    python examples/basic.py

The ONLY differences from talking to OpenAI directly:
  - base_url points at Compass
  - api_key is ignored (Compass holds the real provider keys)
  - model is a Compass selector, e.g. "compass/auto"
"""

from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:4000/v1",
    api_key="unused-compass-holds-the-real-keys",
)

resp = client.chat.completions.create(
    model="compass/auto",  # or "compass/coding", "claude-opus-5", "ollama/qwen3:8b"
    messages=[{"role": "user", "content": "Write a Python one-liner to flatten a list of lists"}],
    max_tokens=500,
)

print(resp.choices[0].message.content)
# Compass tells you where it routed, in a nonstandard field on the response:
compass = resp.model_dump().get("compass")
if compass:
    print(f"\n↳ routed to {compass['provider']}/{compass['model']} ({compass['intent']})")
