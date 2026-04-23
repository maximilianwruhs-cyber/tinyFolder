---
status: completed
action: search
started_at: '2026-04-18T11:30:04.276Z'
completed_at: '2026-04-18T11:30:11.637Z'
---

How does speculative decoding work with Qwen 0.5B as a draft model? What llama.cpp flags are needed?



---

## GZMO Response
*2026-04-18T11:30:11.635Z*

Speculative Decoding with Qwen 0.5B as Draft Model:
Qwen 0.5B functions as a draft model for Qwen 32B, where the draft model predicts the next token based on its knowledge and then both models verify the correctness of the predicted token against the target model (main model). If they agree, the main model accepts it; otherwise, it discards the prediction.

Llama.cpp Flags Needed:
To enable speculative decoding with Qwen 0.5B as a draft model using `llama.cpp`, you would compile it with specific flags including support for GPU (`GGML_CUDA=ON`) and specifying the models to be used:
```bash
CMAKE_ARGS="-DGGML_CUDA=ON -DLLAMA_MODEL_PATH=/path/to/qwen2.5-32b-instruct.gguf \
            -DLLAMA_DRAFT_MODEL_PATH=/path/to/qwen2.5-0.5b-inspect.gguf"
```
Then, run the deployment with:
```bash
./llama-server -m /path/to/qwen2.5-32b-instruct.gguf -md /path/to/qwen2.5-0.5b-inspect.gguf
```

These flags tell `llama.cpp` to use `/path/to/qwen2.5-32b-instruct.gguf` as the main model and `/path/to/qwen2.5-0.5b-inspect.gguf` as the draft (or speculative) model for Qwen 0.5B. Adjust paths accordingly based on your setup.
