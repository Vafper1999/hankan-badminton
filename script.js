let playerCount = 0;
let flexPayload = null; 

// ใส่ LIFF ID ของ Hankan Badminton 
const LIFF_ID = "2010086723-ESV925IL"; 

window.onload = async () => {
    try {
        await liff.init({ liffId: LIFF_ID });
    } catch (err) {
        console.error("LIFF Initialization failed", err);
    }
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
    if(!select) return;
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
    const courtPrice = parseFloat(document.getElementById('courtPrice').value) || 0;
    const courtHours = parseFloat(document.getElementById('courtHours').value) || 0;
    const shuttleTubePrice = parseFloat(document.getElementById('shuttleTubePrice').value) || 0;
    const shuttlesPerTube = parseFloat(document.getElementById('shuttlesPerTube').value) || 12;
    const shuttleCountUsed = parseFloat(document.getElementById('shuttleCountUsed').value) || 0;

    const totalCourtCost = courtPrice * courtHours;
    const shuttleUnitPrice = shuttleTubePrice / shuttlesPerTube;
    const totalShuttleCost = shuttleUnitPrice * shuttleCountUsed;
    const totalTripCost = totalCourtCost + totalShuttleCost;

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

    const tbody = document.querySelector('#resultTable tbody');
    tbody.innerHTML = '';
    
    let payList = [];
    let refundList = []; 
    let playerDetails = []; 

    players.forEach(p => {
        const personalDue = p.hours * ratePerHour;
        let personalPrepaid = 0;
        
        if (p.isShuttlePayer) personalPrepaid += (totalShuttleCost / shuttlePayerCount);
        if (p.id === receiverId) personalPrepaid += totalCourtCost;

        const balance = personalPrepaid - personalDue;

        playerDetails.push({
            name: p.name,
            hours: p.hours,
            due: personalDue,
            prepaid: personalPrepaid,
            balance: balance
        });

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
        summary += `----------------------\n🔄 คืนเงินทอนจาก ${mainReceiverName}:\n`;
        refundList.forEach(item => summary += `- ${item.name}: คืน ${item.amount.toFixed(2)} บ.\n`);
    }

    summary += `----------------------\n🏦 โอนที่: ${mainReceiverName}\nบัญชี: ${bankAcc}`;

    document.getElementById('summaryText').value = summary;
    document.getElementById('resultSection').classList.remove('hidden');

    buildFlexMessage(totalTripCost, playerDetails, mainReceiverName, accType, bankName, bankAcc);
    
    const btnLine = document.getElementById('btnSendLine');
    if(btnLine) btnLine.style.display = 'block';
}

function buildFlexMessage(totalCost, playerDetails, receiverName, accType, bankName, bankAcc) {
    let contents = [
        { type: "text", text: `ยอดรวมทริปนี้: ${totalCost.toFixed(2)} บาท`, weight: "bold", size: "sm", color: "#6B9080", align: "center" },
        { type: "separator", margin: "md" }
    ];
    
    contents.push({
        type: "box", layout: "horizontal", margin: "md",
        contents: [
            { type: "text", text: "ชื่อ", size: "xs", color: "#888888", flex: 3 },
            { type: "text", text: "ชม.", size: "xs", color: "#888888", flex: 1, align: "center" },
            { type: "text", text: "ค่าเล่น", size: "xs", color: "#888888", flex: 2, align: "end" },
            { type: "text", text: "สำรอง", size: "xs", color: "#888888", flex: 2, align: "end" },
            { type: "text", text: "โอน/รับ", size: "xs", color: "#888888", flex: 3, align: "end" }
        ]
    });

    playerDetails.forEach(p => {
        let balanceText = "0.00";
        let balanceColor = "#aaaaaa";
        
        if (p.balance > 0) {
            balanceText = `คืน ${p.balance.toFixed(2)}`;
            balanceColor = "#00B900"; 
        } else if (p.balance < 0) {
            balanceText = `โอน ${Math.abs(p.balance).toFixed(2)}`;
            balanceColor = "#E07A5F"; 
        }

        contents.push({
            type: "box", layout: "horizontal", margin: "sm",
            contents: [
                { type: "text", text: p.name, size: "xs", color: "#111111", flex: 3, weight: "bold", wrap: true },
                { type: "text", text: p.hours.toString(), size: "xs", color: "#555555", flex: 1, align: "center" },
                { type: "text", text: p.due.toFixed(2), size: "xs", color: "#555555", flex: 2, align: "end" },
                { type: "text", text: p.prepaid.toFixed(2), size: "xs", color: "#555555", flex: 2, align: "end" },
                { type: "text", text: balanceText, size: "xs", color: balanceColor, flex: 3, align: "end", weight: "bold" }
            ]
        });
    });

    contents.push({ type: "separator", margin: "md" });
    contents.push({ type: "text", text: `🏦 โอนไปที่: ${receiverName}`, weight: "bold", size: "sm", margin: "md" });
    
    if (accType === 'bank') {
        contents.push({ type: "text", text: `ธนาคาร: ${bankName}`, size: "sm", color: "#555555" });
        contents.push({ type: "text", text: `เลขบัญชี: ${bankAcc}`, size: "sm", color: "#555555", weight: "bold" });
    } else {
        contents.push({ type: "text", text: `พร้อมเพย์: ${bankAcc}`, size: "sm", color: "#555555", weight: "bold" });
        
        if (bankAcc.length >= 10) {
            let cleanNumber = bankAcc.replace(/[^0-9]/g, '');
            contents.push({ type: "separator", margin: "md" });
            contents.push({
                type: "image",
                url: `https://promptpay.io/${cleanNumber}.png`, 
                size: "xl", 
                margin: "md"
            });
            contents.push({ type: "text", text: "สแกน QR ระบุยอดเอง", size: "xs", color: "#aaaaaa", align: "center", margin: "sm" });
        }
    }

    flexPayload = {
        type: "flex",
        altText: "🏸 แจ้งยอดค่าแบดมินตัน",
        contents: {
            type: "bubble",
            size: "mega", 
            header: {
                type: "box", layout: "vertical", backgroundColor: "#E2F0CB",
                contents: [{ type: "text", text: "🏸 บิลค่าแบดมินตัน", weight: "bold", size: "md", color: "#555555", align: "center" }]
            },
            body: { type: "box", layout: "vertical", spacing: "sm", contents: contents }
        }
    };
}

async function sendToLine() {
    if (!flexPayload) return;
    try {
        await liff.sendMessages([flexPayload]);
        alert("✅ ส่งบิลเข้าแชทเรียบร้อย!");
        liff.closeWindow(); 
    } catch (err) {
        alert("❌ ส่งไม่สำเร็จ! กรุณาเช็คว่าติ๊กเปิด 'chat_message.write' ใน LINE Developers หรือยัง\n\nError: " + err.message);
    }
}

function copyText() {
    const text = document.getElementById('summaryText');
    text.select();
    navigator.clipboard.writeText(text.value).then(() => alert("✅ ก๊อปปี้แล้ว!"));
}