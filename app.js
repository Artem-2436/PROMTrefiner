// --- Configuration & State ---
// Default model is Llama 3 70B as requested
const DEFAULT_MODEL = "meta-llama/Meta-Llama-3-70B-Instruct"; 
let hfToken = "";
let selectedModel = DEFAULT_MODEL;

// DOM Elements
const promptInput = document.getElementById('promptInput');
const improvedOutput = document.getElementById('improvedOutput');
const analyzeBtn = document.getElementById('analyzeBtn');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const resultsContainer = document.getElementById('resultsContainer');
const scoreValue = document.getElementById('scoreValue');
const scoreCircle = document.getElementById('scoreCircle');
const tipsList = document.getElementById('tipsList');
const hfTokenInput = document.getElementById('hfToken');
const modelSelect = document.getElementById('modelSelect');

// --- Initialization ---
window.onload = () => {
    // Load settings from localStorage
    const savedToken = localStorage.getItem('asinhrom_hf_token');
    const savedModel = localStorage.getItem('asinhrom_model');
    
    if (savedToken) hfTokenInput.value = savedToken;
    
    if (savedModel) {
        // Verify the saved model still exists in options, otherwise reset to default
        const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
        if(optionExists) {
            modelSelect.value = savedModel;
        } else {
            modelSelect.value = DEFAULT_MODEL;
        }
    } else {
        modelSelect.value = DEFAULT_MODEL;
    }
};

function saveSettings() {
    hfToken = hfTokenInput.value.trim();
    selectedModel = modelSelect.value;
    
    if (!hfToken) {
        alert("Пожалуйста, введите токен Hugging Face.");
        return;
    }

    localStorage.setItem('asinhrom_hf_token', hfToken);
    localStorage.setItem('asinhrom_model', selectedModel);
    alert("Настройки сохранены!");
}

function clearAll() {
    promptInput.value = '';
    improvedOutput.value = '';
    resultsContainer.classList.add('hidden');
    resetScoreVisual();
}

// --- Core Logic: Analysis ---

async function startAnalysis() {
    const originalPrompt = promptInput.value.trim();
    
    if (!originalPrompt) {
        alert("Введите текст промпта сначала!");
        return;
    }
    if (!hfToken && !localStorage.getItem('asinhrom_hf_token')) {
        alert("Сначала настройте API ключ Hugging Face в верхней панели.");
        return;
    }

    // Update UI state
    setLoading(true);
    resultsContainer.classList.remove('hidden');
    improvedOutput.value = "Анализирую...";
    tipsList.innerHTML = "<li class='feedback-item'>Загрузка данных...</li>";

    try {
        // 1. Local Pre-check
        const localTips = performLocalCheck(originalPrompt);
        
        // 2. Call Hugging Face API
        const aiResponse = await callHuggingFaceAPI(originalPrompt);
        
        // 3. Process AI Response
        processAIResponse(aiResponse, localTips, originalPrompt);

    } catch (error) {
        console.error(error);
        let errorMsg = error.message;
        
        // Specific handling for common HF errors
        if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
            errorMsg = "Ошибка авторизации (401). Проверьте правильность токена или наличие доступа к модели.";
        } else if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
            errorMsg = "Доступ запрещен (403). Возможно, требуется принять условия использования модели на сайте Hugging Face.";
        } else if (errorMsg.includes("loading")) {
             errorMsg = "Модель 'просыпается'. Подождите 10-20 секунд и попробуйте снова.";
        }

        improvedOutput.value = `❌ Ошибка: ${errorMsg}`;
        tipsList.innerHTML = `<li class='feedback-item' style='color:var(--danger)'>Не удалось связаться с ИИ.</li>`;
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        btnText.style.display = 'none';
        spinner.classList.remove('hidden');
        analyzeBtn.disabled = true;
    } else {
        btnText.style.display = 'inline';
        spinner.classList.add('hidden');
        analyzeBtn.disabled = false;
    }
}

// --- Helper: Local Heuristics ---
function performLocalCheck(prompt) {
    let tips = [];
    let score = 100;
    const lowerPrompt = prompt.toLowerCase();

    if (prompt.length < 10) {
        tips.push({ text: "Промпт слишком короткий. Добавьте контекст.", impact: "high" });
        score -= 20;
    }

    if (!lowerPrompt.includes("act as") && !lowerPrompt.includes("role") && !lowerPrompt.includes("ты")) {
        tips.push({ text: "Нет указания роли. Начните с 'Ты эксперт...' ", impact: "medium" });
        score -= 10;
    }

    if (!prompt.includes("\n") && prompt.length > 50) {
        tips.push({ text: "Разбейте сложный запрос на пункты для лучшей структуры.", impact: "low" });
        score -= 5;
    }

    const vagueWords = ["что-нибудь", "нормально", "круто", "быстро"];
    vagueWords.forEach(word => {
        if (lowerPrompt.includes(word)) {
            tips.push({ text: `Избегайте размытых терминов ("${word}").`, impact: "medium" });
            score -= 5;
        }
    });

    return { tips, score };
}

// --- Helper: Hugging Face Integration ---
async function callHuggingFaceAPI(userPrompt) {
    const url = `https://api-inference.huggingface.co/models/${selectedModel}`;
    
    // Optimized System Prompt for Llama 3 and similar instruct models
    // We ask for strict JSON to make parsing reliable
    const systemInstruction = `You are a Senior Prompt Engineer specializing in Large Language Models. 
Your task is to analyze the user's prompt provided below and optimize it.

Return ONLY a valid JSON object with this exact structure:
{
  "score": <integer between 0 and 100>,
  "critique": [<array of strings with specific advice on what to change/add/remove>],
  "optimized_prompt": "<string containing the fully rewritten, high-quality version of the user's prompt>"
}

Rules:
1. If the input is garbage or unsafe, give it a low score (<20) and explain why in critique.
2. The optimized_prompt should be clear, concise, and structured (using bullet points if necessary).
3. Do NOT include markdown formatting like \`\`\`json around your output. Just raw JSON.

User Input: """${userPrompt}"""`;

    const response = await fetch(url, {
        headers: { 
            Authorization: `Bearer ${hfToken}`,
            "Content-Type": "application/json"
        },
        method: "POST",
        body: JSON.stringify({ 
            inputs: systemInstruction,
            parameters: {
                max_new_tokens: 512,
                temperature: 0.7,
                top_p: 0.9
            }
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Hugging Face Inference API can return different formats depending on the model endpoint config
    // Sometimes it's an array of objects [{generated_text: "..."}]
    // Sometimes just a string "..."
    // Sometimes nested deeper
    
    let generatedText = "";
    
    if (Array.isArray(data)) {
        if (data[0] && data[0].generated_text) {
            generatedText = data[0].generated_text;
        } else if (typeof data[0] === 'string') {
            generatedText = data[0];
        }
    } else if (data.generated_text) {
        generatedText = data.generated_text;
    } else if (typeof data === 'string') {
        generatedText = data;
    }

    if (!generatedText) {
        throw new Error("Не удалось извлечь текст из ответа API");
    }

    return generatedText;
}

// --- Helper: Processing Results ---
function processAIResponse(rawAiText, localData, originalPrompt) {
    let finalScore = localData.score;
    let finalTips = [...localData.tips];
    let optimizedPrompt = rawAiText; 

    // Clean up potential markdown wrappers from the model
    let jsonStr = rawAiText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    // Try to find the first '{' and last '}' to isolate JSON if there's extra chatter
    const startIndex = jsonStr.indexOf('{');
    const endIndex = jsonStr.lastIndexOf('}');
    
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        jsonStr = jsonStr.substring(startIndex, endIndex + 1);
    }

    try {
        const parsed = JSON.parse(jsonStr);
        
        if (parsed.score !== undefined) {
            // Weighted average: Trust AI more if it gave a concrete number
            finalScore = Math.round((finalScore * 0.3) + (parsed.score * 0.7));
        }
        
        if (parsed.critique && Array.isArray(parsed.critique)) {
            parsed.critique.forEach(c => {
                if (!finalTips.some(t => t.text === c)) {
                    finalTips.push({ text: c, impact: "high" });
                }
            });
        }

        if (parsed.optimized_prompt) {
            optimizedPrompt = parsed.optimized_prompt;
        }

    } catch (e) {
        console.warn("JSON Parse failed:", e);
        // Fallback: Assume the whole text is the optimized prompt if parsing fails
        optimizedPrompt = rawAiText;
        finalTips.push({ text: "ИИ вернул ответ не в формате JSON. Результат показан как есть.", impact: "info" });
    }

    updateScoreUI(finalScore);
    renderTips(finalTips);
    improvedOutput.value = optimizedPrompt;
}

function updateScoreUI(score) {
    scoreValue.innerText = score;
    
    let color = "#ef4444"; // Red
    if (score >= 70) color = "#f59e0b"; // Orange/Yellow
    if (score >= 90) color = "#10b981"; // Green

    const percentage = score;
    scoreCircle.style.background = `conic-gradient(${color} ${percentage}%, rgba(255,255,255,0.1) ${percentage}%)`;
    scoreValue.style.color = color;
}

function renderTips(tips) {
    tipsList.innerHTML = '';
    if (tips.length === 0) {
        tipsList.innerHTML = '<li class="feedback-item" style="color:var(--success)">✅ Промпт выглядит отлично!</li>';
        return;
    }

    tips.forEach(tip => {
        const li = document.createElement('li');
        li.className = 'feedback-item';
        
        let icon = "💡";
        if (tip.impact === "high") icon = "⚠️";
        if (tip.impact === "info") icon = "ℹ️";

        li.innerHTML = `${icon} <strong>${tip.text}</strong>`;
        tipsList.appendChild(li);
    });
}

function resetScoreVisual() {
    scoreValue.innerText = "--";
    scoreCircle.style.background = "rgba(255,255,255,0.1)";
    scoreValue.style.color = "white";
    tipsList.innerHTML = "";
}

// --- Copy Functionality ---
function copyImproved() {
    const text = improvedOutput.value;
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.innerText;
        btn.innerText = "✅ Скопировано!";
        setTimeout(() => {
            btn.innerText = originalText;
        }, 2000);
    }).catch(err => {
        alert("Не удалось скопировать: " + err);
    });
}
