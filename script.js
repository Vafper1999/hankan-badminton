let playerCount = 0;
let flexPayload = null; // สำหรับเก็บข้อมูล Flex Message

// ใส่ LIFF ID ของ Hankan Badminton ที่คุณสร้าง
const LIFF_ID = "2010086723-ESV925IL"; 

window.onload = async () => {
    // เริ่มต้นระบบ LIFF
    try {
        await liff.init({ liffId: LIFF_ID });
    } catch (err) {
        console.error("LIFF Initialization failed", err);
    }

    // เริ่มต้นใส่ชื่อตัวอย่าง (สามารถลบออกได้ถ้าต้องการให้หน้าเว็บว่างตอนเริ่ม)
    updateReceiverList();
};

function addPlayer(name = '', hours = 2) {
    playerCount++;
    const id = `player_${playerCount}`;
    const div = document.createElement('div');
    div.className = 'player-row';
    div.id = id;
    div.innerHTML = `
        <input type="text" class="p-name" placeholder="ชื่อ" value="${name}" oninput="updateReceiverList()">
        <input type="number" class="p-hours" placeholder="ชม." value="${hours}" step="0.5">
        <label class="checkbox-group">
            <input type="checkbox" class="p-shuttle"> จ่ายค่าลูก
        </label>
        <button class="btn-remove" onclick="removePlayer('${id}')">X</button>
    `;
    document.getElementById('playersList').appendChild(div);
    updateReceiverList();
}

function removePlayer(id) {
    document.getElementById(id).remove();
    updateReceiverList();
}

function updateReceiverList() {
    const select = document.getElementById('receiverSelect');
    const currentVal = select.value;
    select.innerHTML = '<option value="external">-- คนนอก --</option>';
    document.querySelectorAll('.p-name').forEach((input, index) => {
        const name = input.value.trim();
        if (name) {
            const option = document.createElement('option');
            option.value = index.toString();
            option.textContent = name;
            select.appendChild(option);
        }
    });
    select.value = currentVal;
}

function calculate() {
    // 1. ดึงข้อมูลพื้นฐาน
    const courtPrice = parseFloat(document.getElementById('courtPrice').value) || 0;
    const courtHours = parseFloat(document.getElementById('courtHours').value) || 0;
    const shuttleTubePrice = parseFloat(document.getElementById('shuttleTubePrice').value) || 0;
    const shuttlesPerTube = parseFloat(document.getElementById('shuttlesPerTube').value) || 12;
    const shuttleCountUsed = parseFloat(document.getElementById('shuttleCountUsed').value) || 0;

    const totalCourtCost = courtPrice * courtHours;
    const shuttleUnitPrice = shuttleTubePrice / shuttlesPerTube;
    const totalShuttleCost = shuttleUnitPrice * shuttleCountUsed;
    const totalTripCost = totalCourtCost + totalShuttleCost;

    // 2. ข้อมูลคนเล่น
    const rows = document.querySelectorAll('.player-row');
    let players = [];
    let totalHours = 0;
    let shuttlePayerCount = 0;

    rows.forEach((row, index) => {
        const name = row.querySelector('.p-name').value.trim() || `คนที่ ${index+1}`;
        const hours = parseFloat(row.querySelector('.p-hours').value) || 0;
        const isShuttlePayer = row.querySelector('.p-shuttle').checked;
        if(isShuttlePayer) shuttlePayerCount++;
        totalHours += hours;
        players.push({ id: index.toString(), name, hours, isShuttlePayer });
    });

    if (totalHours === 0) return alert("กรุณากรอกชั่วโมงเล่น");

    const ratePerHour = totalTripCost / totalHours;
    const receiverId = document.getElementById('receiverSelect').value;

    // 3. คำนวณรายคน
    const tbody = document.querySelector('#resultTable tbody');
    tbody.innerHTML = '';
    let payList = [];
    let refundList = []; 

    players.forEach(p => {
        const personalDue = p.hours * ratePerHour;
        let personalPrepaid = 0;
        
        if (p.isShuttlePayer) personalPrepaid += (totalShuttleCost / shuttlePayerCount);
        if (p.id === receiverId) personalPrepaid += totalCourtCost;

        const balance = personalPrepaid - personalDue;

        let statusText = "";
        if (balance > 0) {
            statusText = `<span style="color:green">ได้รับคืน ${balance.toFixed(2)}</span>`;
            if (p.id !== receiverId) refundList.push({ name: p.name, amount: balance });
        } else if (balance < 0) {
            statusText = `<span style="color:red">โอนเพิ่ม ${Math.abs(balance).toFixed(2)}</span>`;
            if (p.id !== receiverId) payList.push({ name: p.name, amount: Math.abs(balance) });
        } else {
            statusText = "0.00";
        }

        tbody.innerHTML += `<tr>
            <td>${p.name}</td>
            <td>${p.hours}</td>
            <td>${personalDue.toFixed(2)}</td>
            <td>${personalPrepaid.toFixed(2)}</td>
            <td><strong>${statusText}</strong></td>
        </tr>`;
    });

    // 4. สรุปข้อมูลธนาคาร/รับเงิน
    let mainReceiverName = "คนรับเงิน";
    if (receiverId !== "external") {
        const r = players.find(p => p.id === receiverId);
        mainReceiverName = r ? r.name : "คนรับเงิน";
    }

    const bankName = document.getElementById('bankName').value.trim() || '-';
    const bankAcc = document.getElementById('bankAccount').value.trim() || '-';
    const accType = document.getElementById('accType').value;

    let summary = `🏸 สรุปค่าแบดมินตัน\n`;
    summary += `ยอดรวม: ${totalTripCost.toFixed(2)} บ. (คอร์ท ${totalCourtCost} / ลูก ${totalShuttleCost.toFixed(2)})\n`;
    summary += `----------------------\n💸 ยอดโอน:\n`;
    payList.forEach(item => summary += `- ${item.name}: ${item.amount.toFixed(2)} บ.\n`);
    
    if (refundList.length > 0) {
        summary += `----------------------\n🔄 คนรอรับเงินคืนจาก ${mainReceiverName}:\n`;
        refundList.forEach(item => summary += `- ${item.name}: ได้รับคืน ${item.amount.toFixed(2)} บ.\n`);
    }

    summary += `----------------------\n🏦 โอนที่: ${mainReceiverName}\n`;
    summary += `บัญชี/พร้อมเพย์: ${bankAcc}\n`;

    document.getElementById('summaryText').value = summary;
    document.getElementById('resultSection').classList.remove('hidden');

    // 5. สร้าง Flex Message Payload
    buildFlexMessage(totalTripCost, payList, refundList, mainReceiverName, accType, bankName, bankAcc);
    
    // แสดงปุ่มส่งเข้า LINE
    const btnLine = document.getElementById('btnSendLine');
    if(btnLine) btnLine.style.display = 'block';
}

function buildFlexMessage(totalCost, payList, refundList, receiverName, accType, bankName, bankAcc) {
    let contents = [
        { type: "text", text: `ยอดรวมทริปนี้: ${totalCost.toFixed(2)} บาท`, weight: "bold", size: "sm", color: "#6B9080" },
        { type: "separator", margin: "md" }
    ];
    
    contents.push({ type: "text", text: "💸 ยอดที่ต้องโอน:", weight: "bold", size: "sm", margin: "md", color: "#E07A5F" });
    payList.forEach(p => {
        contents.push({
            type: "box", layout: "horizontal",
            contents: [
                { type: "text", text: p.name, size: "sm", color: "#555555", flex: 2 },
                { type: "text", text: `${p.amount.toFixed(2)} บ.`, size: "sm", color: "#555555", align: "end", flex: 1, weight: "bold" }
            ]
        });
    });

    if (refundList.length > 0) {
        contents.push({ type: "separator", margin: "md" });
        contents.push({ type: "text", text: `🔄 คืนเงินทอนจาก ${receiverName}:`, weight: "bold", size: "sm", margin: "md", color: "#8AB6D6" });
        refundList.forEach(p => {
            contents.push({
                type: "box", layout: "horizontal",
                contents: [
                    { type: "text", text: p.name, size: "sm", color: "#555555", flex: 2 },
                    { type: "text", text: `${p.amount.toFixed(2)} บ.`, size: "sm", color: "#555555", align: "end", flex: 1, weight: "bold" }
                ]
            });
        });
    }

    contents.push({ type: "separator", margin: "md" });
    contents.push({ type: "text", text: `🏦 โอนไปที่: ${receiverName}`, weight: "bold", size: "sm", margin: "md" });
    
    if (accType === 'bank') {
        contents.push({ type: "text", text: `ธนาคาร: ${bankName}`, size: "sm", color: "#555555" });
        contents.push({ type: "text", text: `เลขบัญชี: ${bankAcc}`, size: "sm", color: "#555555", weight: "bold" });
    } else {
        contents.push({ type: "text", text: `พร้อมเพย์: ${bankAcc}`, size: "sm", color: "#555555", weight: "bold" });
    }

    let bubble = {
        type: "bubble",
        size: "giga",
        header: {
            type: "box", layout: "vertical", backgroundColor: "#E2F0CB",
            contents: [{ type: "text", text: "🏸 บิลค่าแบดมินตัน", weight: "bold", size: "lg", color: "#555555", align: "center" }]
        },
        body: { type: "box", layout: "vertical", spacing: "sm", contents: contents }
    };

    // เพิ่ม QR Code ถ้าเป็นพร้อมเพย์
    if (accType === 'promptpay' && bankAcc.length >= 10) {
        let cleanNumber = bankAcc.replace(/[^0-9]/g, '');
        bubble.hero = {
            type: "image",
            url: `https://promptpay.io/${cleanNumber}.png`,
            size: "full",
            aspectRatio: "1:1",
            aspectMode: "cover"
        };
    }

    flexPayload = {
        type: "flex",
        altText: "🏸 แจ้งยอดค่าแบดมินตัน",
        contents: bubble
    };
}

async function sendToLine() {
    if (!liff.isInClient()) {
        alert("กรุณาเปิดผ่านแอป LINE เพื่อส่งข้อความเข้ากลุ่มครับ");
        return;
    }
    try {
        await liff.sendMessages([flexPayload]);
        liff.closeWindow(); 
    } catch (err) {
        alert("เกิดข้อผิดพลาด: " + err);
    }
}

function copyText() {
    const text = document.getElementById('summaryText');
    text.select();
    navigator.clipboard.writeText(text.value).then(() => alert("✅ ก๊อปปี้แล้ว!"));
}