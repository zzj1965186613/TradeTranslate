// TradeTranslate Input Test ¡ª paste this in WhatsApp Web console
// First click on the chat input box, then run this script

(function() {
    const input = document.querySelector('[data-testid="conversation-compose-box-input"]');
    if (!input) { console.log("ERROR: No input found"); return; }
    
    const results = [];
    
    // Test 1: beforeinput deleteContentBackward
    input.focus();
    document.execCommand("selectAll");
    const evt1 = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        bubbles: true, cancelable: true, composed: true
    });
    input.dispatchEvent(evt1);
    const after1 = input.innerText?.trim();
    results.push("After beforeinput delete: '" + after1 + "'");
    
    // Test 2: beforeinput insertText
    input.focus();
    const evt2 = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "TEST_INSERT",
        bubbles: true, cancelable: true, composed: true
    });
    input.dispatchEvent(evt2);
    const after2 = input.innerText?.trim();
    results.push("After beforeinput insertText: '" + after2 + "'");
    
    // Test 3: execCommand insertText
    input.focus();
    document.execCommand("selectAll");
    const r3 = document.execCommand("insertText", false, "TEST_EXEC");
    const after3 = input.innerText?.trim();
    results.push("execCommand insertText result=" + r3 + ", text: '" + after3 + "'");
    
    // Test 4: Paste event
    input.focus();
    document.execCommand("selectAll");
    try {
        const dt = new DataTransfer();
        dt.setData("text/plain", "TEST_PASTE");
        const pe = new ClipboardEvent("paste", {
            clipboardData: dt, bubbles: true, cancelable: true, composed: true
        });
        input.dispatchEvent(pe);
    } catch(e) {
        results.push("Paste event error: " + e.message);
    }
    const after4 = input.innerText?.trim();
    results.push("After paste event: '" + after4 + "'");
    
    console.log("=== TradeTranslate Input Test ===");
    results.forEach(r => console.log(r));
    console.log("=== END ===");
})();
