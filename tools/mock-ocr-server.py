#!/usr/bin/env python3
# OpenAI 兼容 + Anthropic 兼容 OCR mock：
#   GET  /models            → OpenAI 模型列表
#   POST /chat/completions  → OpenAI 首轮低置信 / 重读精读
#   GET  /v1/models         → Anthropic 模型列表
#   POST /v1/messages       → Anthropic 消息（首轮低置信 / 重读精读）
import json
import http.server

COUNT = {"n": 0}
OPENAI_MODELS = [
    {"id": "mock-ocr-v1", "object": "model", "owned_by": "mock"},
    {"id": "mock-ocr-v2", "object": "model", "owned_by": "mock"},
    {"id": "mock-vl-pro", "object": "model", "owned_by": "mock"},
]
ANTHROPIC_MODELS = [
    {"id": "claude-mock-1", "display_name": "Mock Claude 1", "type": "model"},
    {"id": "claude-mock-2", "display_name": "Mock Claude 2", "type": "model"},
]


def ocr_items(reread):
    if reread:
        return [
            {"text": "HELLO 42", "box": [40, 30, 200, 150], "confidence": 0.97},
            {"text": "精确文本", "box": [120, 80, 300, 180], "confidence": 0.95},
        ]
    return [
        {"text": "HELL0 4?", "box": [40, 30, 200, 150], "confidence": 0.42},
        {"text": "精确文本", "box": [120, 80, 300, 180], "confidence": 0.95},
    ]


def user_text_of(req):
    text = ""
    has_image = False
    for msg in req.get("messages", []):
        if msg.get("role") == "user":
            for c in msg.get("content", []):
                if c.get("type") == "text":
                    text += c.get("text", "")
                if c.get("type") == "image_url" and c.get("image_url", {}).get("url", "").startswith("data:image/"):
                    has_image = True
    return text, has_image


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/models":
            return self._send({"object": "list", "data": OPENAI_MODELS})
        if self.path == "/v1/models":
            return self._send({"data": ANTHROPIC_MODELS, "has_more": False, "first_id": None, "last_id": None})
        self.send_error(404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            req = json.loads(body or b"{}")
        except Exception:
            req = {}
        if self.path == "/chat/completions":
            text, has_image = user_text_of(req)
            if not has_image:
                self.send_error(400, "missing image_url")
                return
            COUNT["n"] += 1
            reread = ("重读" in text) or ("置信度不足" in text)
            return self._send({"choices": [{"message": {"content": json.dumps(ocr_items(reread), ensure_ascii=False)}}]})
        if self.path == "/v1/messages":
            text = ""
            has_image = False
            for c in req.get("messages", [{}])[0].get("content", []):
                if c.get("type") == "text":
                    text += c.get("text", "")
                if c.get("type") == "image" and c.get("source", {}).get("type") == "base64" and c.get("source", {}).get("data"):
                    has_image = True
            if not has_image:
                self.send_error(400, "missing image source")
                return
            COUNT["n"] += 1
            reread = ("重读" in text) or ("置信度不足" in text)
            return self._send({"content": [{"type": "text", "text": json.dumps(ocr_items(reread), ensure_ascii=False)}]})
        self.send_error(404)


if __name__ == "__main__":
    http.server.HTTPServer(("127.0.0.1", 18923), Handler).serve_forever()
