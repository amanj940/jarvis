"""Central Provider Catalog for JARVIS.

Inspired by free-claude-code's neutral provider catalog architecture.
Defines endpoints, protocols, default models, suggested models, and probe targets.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ProviderProtocol(StrEnum):
    OPENAI_COMPATIBLE = "openai_compatible"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    OLLAMA = "ollama"


@dataclass(frozen=True, slots=True)
class ProviderSpec:
    id: str
    name: str
    protocol: ProviderProtocol
    default_base_url: str
    credential_env: str
    default_model: str
    suggested_models: tuple[str, ...]
    models_path: str = "/models"
    probe_path: str = "/models"
    auth_header_format: str = "Bearer {key}"
    requires_key: bool = True
    supports_native_tools: bool = True
    doc_url: str = ""


# Catalog of supported providers
PROVIDER_CATALOG: dict[str, ProviderSpec] = {
    "groq": ProviderSpec(
        id="groq",
        name="Groq Cloud",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.groq.com/openai/v1",
        credential_env="GROQ_API_KEY",
        default_model="llama-3.3-70b-versatile",
        suggested_models=(
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen-qwq-32b",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://console.groq.com/keys",
    ),
    "gemini": ProviderSpec(
        id="gemini",
        name="Google Gemini",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        credential_env="GEMINI_API_KEY",
        default_model="gemini-2.0-flash",
        suggested_models=(
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-1.5-pro",
            "gemini-1.5-flash",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://aistudio.google.com/apikey",
    ),
    "openai": ProviderSpec(
        id="openai",
        name="OpenAI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.openai.com/v1",
        credential_env="OPENAI_API_KEY",
        default_model="gpt-4o",
        suggested_models=(
            "gpt-4o",
            "gpt-4o-mini",
            "o3-mini",
            "o1",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://platform.openai.com/api-keys",
    ),
    "anthropic": ProviderSpec(
        id="anthropic",
        name="Anthropic Claude",
        protocol=ProviderProtocol.ANTHROPIC,
        default_base_url="https://api.anthropic.com",
        credential_env="ANTHROPIC_API_KEY",
        default_model="claude-3-5-sonnet-20241022",
        suggested_models=(
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        ),
        models_path="/v1/models",
        probe_path="/v1/models?limit=1",
        auth_header_format="{key}",
        doc_url="https://console.anthropic.com/settings/keys",
    ),
    "openrouter": ProviderSpec(
        id="openrouter",
        name="OpenRouter",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://openrouter.ai/api/v1",
        credential_env="OPENROUTER_API_KEY",
        default_model="anthropic/claude-3.5-sonnet",
        suggested_models=(
            "anthropic/claude-3.5-sonnet",
            "meta-llama/llama-3.3-70b-instruct",
            "google/gemini-2.0-flash-001",
            "deepseek/deepseek-chat",
            "deepseek/deepseek-r1",
        ),
        models_path="/models",
        probe_path="/auth/key",
        doc_url="https://openrouter.ai/keys",
    ),
    "deepseek": ProviderSpec(
        id="deepseek",
        name="DeepSeek",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.deepseek.com",
        credential_env="DEEPSEEK_API_KEY",
        default_model="deepseek-chat",
        suggested_models=(
            "deepseek-chat",
            "deepseek-reasoner",
        ),
        models_path="/models",
        probe_path="/user/balance",
        doc_url="https://platform.deepseek.com/api_keys",
    ),
    "mistral": ProviderSpec(
        id="mistral",
        name="Mistral AI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.mistral.ai/v1",
        credential_env="MISTRAL_API_KEY",
        default_model="mistral-large-latest",
        suggested_models=(
            "mistral-large-latest",
            "mistral-small-latest",
            "codestral-latest",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://console.mistral.ai/api-keys/",
    ),
    "cerebras": ProviderSpec(
        id="cerebras",
        name="Cerebras",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.cerebras.ai/v1",
        credential_env="CEREBRAS_API_KEY",
        default_model="llama-3.3-70b",
        suggested_models=(
            "llama-3.3-70b",
            "llama3.1-8b",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://cloud.cerebras.ai/",
    ),
    "nvidia": ProviderSpec(
        id="nvidia",
        name="NVIDIA NIM",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://integrate.api.nvidia.com/v1",
        credential_env="NVIDIA_API_KEY",
        default_model="meta/llama-3.3-70b-instruct",
        suggested_models=(
            "meta/llama-3.3-70b-instruct",
            "deepseek-ai/deepseek-r1",
            "nvidia/llama-3.1-nemotron-70b-instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://build.nvidia.com/settings/api-keys",
    ),
    "ollama": ProviderSpec(
        id="ollama",
        name="Ollama (Local)",
        protocol=ProviderProtocol.OLLAMA,
        default_base_url="http://localhost:11434/v1",
        credential_env="",
        default_model="llama3.2:1b",
        suggested_models=(
            "llama3.2:1b",
            "llama3.2:latest",
            "smollm2:360m",
            "qwen2.5:latest",
            "mistral:latest",
            "deepseek-r1:latest",
        ),
        models_path="/v1/models",
        probe_path="/v1/models",
        requires_key=False,
        doc_url="https://ollama.com",
    ),
    "lmstudio": ProviderSpec(
        id="lmstudio",
        name="LM Studio (Local)",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="http://localhost:1234/v1",
        credential_env="",
        default_model="local-model",
        suggested_models=("local-model",),
        models_path="/models",
        probe_path="/models",
        requires_key=False,
        doc_url="https://lmstudio.ai",
    ),
    "sambanova": ProviderSpec(
        id="sambanova",
        name="SambaNova Cloud",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.sambanova.ai/v1",
        credential_env="SAMBANOVA_API_KEY",
        default_model="Meta-Llama-3.3-70B-Instruct",
        suggested_models=(
            "Meta-Llama-3.3-70B-Instruct",
            "Meta-Llama-3.1-405B-Instruct",
            "Meta-Llama-3.1-70B-Instruct",
            "DeepSeek-R1",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://cloud.sambanova.ai/apis",
    ),
    "cohere": ProviderSpec(
        id="cohere",
        name="Cohere",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.cohere.ai/compatibility/v1",
        credential_env="COHERE_API_KEY",
        default_model="command-r-plus-08-2024",
        suggested_models=(
            "command-r-plus-08-2024",
            "command-r-08-2024",
            "command-r7b-12-2024",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://dashboard.cohere.com/api-keys",
    ),
    # ── New providers from free-claude-code ──────────────────────────────────
    "together": ProviderSpec(
        id="together",
        name="Together AI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.together.ai/v1",
        credential_env="TOGETHER_API_KEY",
        default_model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "deepseek-ai/DeepSeek-R1",
            "Qwen/Qwen2.5-72B-Instruct-Turbo",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://api.together.ai/settings/api-keys",
    ),
    "deepinfra": ProviderSpec(
        id="deepinfra",
        name="DeepInfra",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.deepinfra.com/v1/openai",
        credential_env="DEEPINFRA_API_KEY",
        default_model="meta-llama/Llama-3.3-70B-Instruct",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct",
            "deepseek-ai/DeepSeek-R1",
            "Qwen/Qwen2.5-72B-Instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://deepinfra.com/dash/api_keys",
    ),
    "siliconflow": ProviderSpec(
        id="siliconflow",
        name="SiliconFlow",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.siliconflow.com/v1",
        credential_env="SILICONFLOW_API_KEY",
        default_model="Qwen/Qwen2.5-72B-Instruct",
        suggested_models=(
            "Qwen/Qwen2.5-72B-Instruct",
            "deepseek-ai/DeepSeek-R1",
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://cloud.siliconflow.com/account/ak",
    ),
    "nebius": ProviderSpec(
        id="nebius",
        name="Nebius Token Factory",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.tokenfactory.nebius.com/v1",
        credential_env="NEBIUS_API_KEY",
        default_model="meta-llama/Meta-Llama-3.1-70B-Instruct",
        suggested_models=(
            "meta-llama/Meta-Llama-3.1-70B-Instruct",
            "Qwen/Qwen2.5-72B-Instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://tokenfactory.nebius.com/project/api-keys",
    ),
    "fireworks": ProviderSpec(
        id="fireworks",
        name="Fireworks AI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.fireworks.ai/inference/v1",
        credential_env="FIREWORKS_API_KEY",
        default_model="accounts/fireworks/models/llama-v3p3-70b-instruct",
        suggested_models=(
            "accounts/fireworks/models/llama-v3p3-70b-instruct",
            "accounts/fireworks/models/deepseek-r1",
            "accounts/fireworks/models/qwen2p5-72b-instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://fireworks.ai/account/api-keys",
    ),
    "novita": ProviderSpec(
        id="novita",
        name="Novita AI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.novita.ai/openai/v1",
        credential_env="NOVITA_API_KEY",
        default_model="meta-llama/llama-3.3-70b-instruct",
        suggested_models=(
            "meta-llama/llama-3.3-70b-instruct",
            "deepseek/deepseek-r1",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://novita.ai/settings/key-management",
    ),
    "xai": ProviderSpec(
        id="xai",
        name="xAI (Grok)",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.x.ai/v1",
        credential_env="XAI_API_KEY",
        default_model="grok-3",
        suggested_models=(
            "grok-3",
            "grok-3-mini",
            "grok-2",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://console.x.ai/team/default/api-keys",
    ),
    "huggingface": ProviderSpec(
        id="huggingface",
        name="Hugging Face",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://router.huggingface.co/v1",
        credential_env="HUGGINGFACE_API_KEY",
        default_model="meta-llama/Llama-3.3-70B-Instruct",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct",
            "Qwen/Qwen2.5-72B-Instruct",
            "deepseek-ai/DeepSeek-R1",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://huggingface.co/settings/tokens",
    ),
    "alibaba_cloud": ProviderSpec(
        id="alibaba_cloud",
        name="Alibaba Cloud (Qwen)",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        credential_env="ALIBABA_CLOUD_API_KEY",
        default_model="qwen-max",
        suggested_models=(
            "qwen-max",
            "qwen-plus",
            "qwen-turbo",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://www.alibabacloud.com/help/en/model-studio/get-api-key",
    ),
    "minimax": ProviderSpec(
        id="minimax",
        name="MiniMax",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.minimax.io/v1",
        credential_env="MINIMAX_API_KEY",
        default_model="MiniMax-Text-01",
        suggested_models=(
            "MiniMax-Text-01",
            "abab6.5s-chat",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://platform.minimax.io/user-center/basic-information/interface-key",
    ),
    "kimi": ProviderSpec(
        id="kimi",
        name="Kimi (Moonshot)",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.moonshot.ai/v1",
        credential_env="KIMI_API_KEY",
        default_model="moonshot-v1-128k",
        suggested_models=(
            "moonshot-v1-128k",
            "moonshot-v1-32k",
            "moonshot-v1-8k",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://platform.moonshot.cn/console/api-keys",
    ),
    "scaleway": ProviderSpec(
        id="scaleway",
        name="Scaleway",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.scaleway.ai/v1",
        credential_env="SCW_SECRET_KEY",
        default_model="llama-3.3-70b-instruct",
        suggested_models=(
            "llama-3.3-70b-instruct",
            "deepseek-r1",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://console.scaleway.com/iam/api-keys",
    ),
    "bedrock": ProviderSpec(
        id="bedrock",
        name="Amazon Bedrock",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://bedrock-mantle.us-east-1.api.aws/v1",
        credential_env="AWS_BEARER_TOKEN_BEDROCK",
        default_model="anthropic.claude-3-5-sonnet-20241022-v2:0",
        suggested_models=(
            "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "amazon.nova-pro-v1:0",
            "meta.llama3-3-70b-instruct-v1:0",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://console.aws.amazon.com/bedrock/",
    ),
    "chutes": ProviderSpec(
        id="chutes",
        name="Chutes AI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://llm.chutes.ai/v1",
        credential_env="CHUTES_API_KEY",
        default_model="deepseek-ai/DeepSeek-R1",
        suggested_models=(
            "deepseek-ai/DeepSeek-R1",
            "meta-llama/Llama-3.3-70B-Instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://chutes.ai/docs/getting-started/authentication",
    ),
    "featherless": ProviderSpec(
        id="featherless",
        name="Featherless AI",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.featherless.ai/v1",
        credential_env="FEATHERLESS_API_KEY",
        default_model="meta-llama/Llama-3.3-70B-Instruct",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct",
            "Qwen/Qwen2.5-72B-Instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://featherless.ai/account/api-keys",
    ),
    "wandb": ProviderSpec(
        id="wandb",
        name="W&B Inference",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.inference.wandb.ai/v1",
        credential_env="WANDB_API_KEY",
        default_model="meta-llama/Llama-3.3-70B-Instruct",
        suggested_models=(
            "meta-llama/Llama-3.3-70B-Instruct",
            "Qwen/Qwen2.5-72B-Instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://wandb.ai/settings",
    ),
    "vercel_ai": ProviderSpec(
        id="vercel_ai",
        name="Vercel AI Gateway",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://ai-gateway.vercel.sh/v1",
        credential_env="AI_GATEWAY_API_KEY",
        default_model="anthropic/claude-3-5-sonnet",
        suggested_models=(
            "anthropic/claude-3-5-sonnet",
            "openai/gpt-4o",
            "meta-llama/llama-3.3-70b-instruct",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://vercel.com/docs/ai-gateway",
    ),
    "ollama_cloud": ProviderSpec(
        id="ollama_cloud",
        name="Ollama Cloud",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://ollama.com/v1",
        credential_env="OLLAMA_API_KEY",
        default_model="llama3.3",
        suggested_models=(
            "llama3.3",
            "qwen2.5:72b",
            "deepseek-r1:70b",
        ),
        models_path="/models",
        probe_path="/models",
        doc_url="https://ollama.com/settings/keys",
    ),
    "kilo": ProviderSpec(
        id="kilo",
        name="Kilo Gateway",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.kilo.ai/api/gateway",
        credential_env="KILO_API_KEY",
        default_model="kilo-auto/free",
        suggested_models=(
            "kilo-auto/free",
            "reflection/beam-free",
            "openrouter/free",
        ),
        requires_key=False,
        doc_url="https://kilo.ai",
    ),
    "llm7": ProviderSpec(
        id="llm7",
        name="LLM7.io",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://api.llm7.io/v1",
        credential_env="LLM7_API_KEY",
        default_model="gpt-oss:120b",
        suggested_models=(
            "gpt-oss:120b",
            "codestral-latest",
            "gemma4:31b",
        ),
        requires_key=False,
        doc_url="https://llm7.io",
    ),
    "pollinations": ProviderSpec(
        id="pollinations",
        name="Pollinations",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://text.pollinations.ai/openai",
        credential_env="POLLINATIONS_API_KEY",
        default_model="openai-fast",
        suggested_models=("openai-fast",),
        requires_key=False,
        doc_url="https://pollinations.ai",
    ),
    "ovhcloud": ProviderSpec(
        id="ovhcloud",
        name="OVHcloud AI Endpoints",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
        credential_env="OVHCLOUD_API_KEY",
        default_model="Meta-Llama-3_3-70B-Instruct",
        suggested_models=(
            "Meta-Llama-3_3-70B-Instruct",
            "gpt-oss-120b",
            "gpt-oss-20b",
            "Qwen3.8-27B",
            "Mistral-Small-3.2-24B-Instruct-2506",
        ),
        models_path="/models",
        probe_path="/models",
        requires_key=False,
        doc_url="https://www.ovhcloud.com/en/public-cloud/ai-endpoints",
    ),
    "genrelay": ProviderSpec(
        id="genrelay",
        name="GenRelay",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="https://genrelay.ai/v1",
        credential_env="GENRELAY_API_KEY",
        default_model="glm-5.3",
        suggested_models=("glm-5.3", "glm-5.2", "gemini-3.8-flash"),
        requires_key=True,
        doc_url="https://genrelay.ai/docs",
    ),
    "omniroute": ProviderSpec(
        id="omniroute",
        name="OmniRoute (Local Free Tier Aggregator)",
        protocol=ProviderProtocol.OPENAI_COMPATIBLE,
        default_base_url="http://localhost:20128/v1",
        credential_env="OMNIROUTE_API_KEY",
        default_model="auto",
        suggested_models=(
            "auto",
            "auto/coding",
            "auto/fast",
            "auto/cheap",
        ),
        models_path="/models",
        probe_path="/health",
        requires_key=False,
        doc_url="https://omniroute.hagicode.com",
    ),

}



ProviderInfo = ProviderSpec


def get_provider_spec(provider_id: str) -> ProviderSpec | None:
    return PROVIDER_CATALOG.get(provider_id.lower().strip())


get_provider = get_provider_spec


def list_providers() -> list[ProviderSpec]:
    return list(PROVIDER_CATALOG.values())


def get_cloud_providers() -> list[ProviderSpec]:
    return [p for p in PROVIDER_CATALOG.values() if p.requires_key]


def get_free_tier_providers() -> list[ProviderSpec]:
    """Return providers that offer free tiers or no-key access."""
    return [
        p for p in PROVIDER_CATALOG.values()
        if p.id in {
            "groq",        # Fast free tier
            "gemini",      # Google free tier
            "cerebras",    # Fast inference free tier
            "ollama",      # Local, no key
            "lmstudio",    # Local, no key
            "omniroute",   # Free tier aggregator
            "kilo",        # Free tier gateway (200 req/hour)
            "llm7",        # Free tier (10 req/min)
            "pollinations", # No key needed
            "ovhcloud",    # OVHcloud AI (2 req/min)
        }
    ]
