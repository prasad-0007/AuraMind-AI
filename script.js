const video = document.getElementById('video');
const stressBadge = document.getElementById('stress-badge');
const tutorText = document.getElementById('tutor-text');
const stressBar = document.getElementById('stress-bar');
const learningMode = document.getElementById('learning-mode');

// Load Face-API models from CDN
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/'),
    faceapi.nets.faceExpressionNet.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/')
]).then(startVideo);

function startVideo() {
    navigator.mediaDevices.getUserMedia({ video: {} })
        .then(stream => { video.srcObject = stream; })
        .catch(err => {
            tutorText.innerText = "Error: Camera access denied. Please enable it to run the AI.";
        });
}

video.addEventListener('play', () => {
    setInterval(async () => {
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
        
        if (detections.length > 0) {
            const expressions = detections[0].expressions;
            // Mathematical check for "Stress" markers: Sadness, Anger, Fear
            const stressScore = expressions.sad + expressions.angry + expressions.fearful;
            
            if (stressScore > 0.3) {
                updateUI("STRESSED", "red", "खूप ताण जाणवत आहे का? थोडा वेळ विश्रांती घ्या.", "Mode: Fatigue Recovery", "85%");
            } else {
                updateUI("CALM", "emerald", "तुमची प्रगती चांगली आहे! आपण नवीन धडा शिकूया का?", "Mode: High Concentration", "20%");
            }
        }
    }, 2000);
});

function updateUI(status, color, text, mode, barWidth) {
    stressBadge.innerText = status;
    stressBadge.style.backgroundColor = status === "STRESSED" ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)";
    stressBadge.style.color = status === "STRESSED" ? "#f87171" : "#34d399";
    tutorText.innerText = text;
    learningMode.innerText = mode;
    stressBar.style.width = barWidth;
    stressBar.style.backgroundColor = status === "STRESSED" ? "#ef4444" : "#10b981";
}
