let playerCount = 0;

// เริ่มต้นใส่ชื่อ "ว๊าฟ" และ "แม็ก" เป็นตัวอย่าง
window.onload = () => {
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
    // 1. ข้อมูลพื้นฐาน
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
    let refundList = []; // รายชื่อคนที่จะได้เงินคืน

    players.forEach(p => {
        const personalDue = p.hours * ratePerHour; // ยอดที่ต้องแบกรับ
        let personalPrepaid = 0;
        
        if (p.isShuttlePayer) personalPrepaid += (totalShuttleCost / shuttlePayerCount);
        if (p.id === receiverId) personalPrepaid += totalCourtCost;

        const balance = personalPrepaid - personalDue; // ถ้าบวก = ได้คืน, ถ้าลบ = ต้องจ่ายเพิ่ม

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

    // 4. สร้างข้อความสรุป
    let mainReceiverName = "คนรับเงิน";
    if (receiverId !== "external") {
        const r = players.find(p => p.id === receiverId);
        mainReceiverName = r ? r.name : "คนรับเงิน";
    }

    let summary = `🏸 สรุปค่าแบดมินตัน\n`;
    summary += `ยอดรวม: ${totalTripCost.toFixed(2)} บ. (คอร์ท ${totalCourtCost} / ลูก ${totalShuttleCost.toFixed(2)})\n`;
    summary += `----------------------\n💸 ยอดโอน:\n`;
    payList.forEach(item => summary += `- ${item.name}: ${item.amount.toFixed(2)} บ.\n`);
    
    if (refundList.length > 0) {
        summary += `----------------------\n🔄 คนรอรับเงินคืนจาก ${mainReceiverName}:\n`;
        refundList.forEach(item => summary += `- ${item.name}: ได้รับคืน ${item.amount.toFixed(2)} บ.\n`);
    }

    summary += `----------------------\n🏦 โอนที่: ${mainReceiverName}\n`;
    summary += `ธนาคาร: ${document.getElementById('bankName').value || '-'}\n`;
    summary += `เลขบัญชี: ${document.getElementById('bankAccount').value || '-'}\n`;

    document.getElementById('summaryText').value = summary;
    document.getElementById('resultSection').classList.remove('hidden');
}

function copyText() {
    const text = document.getElementById('summaryText');
    text.select();
    navigator.clipboard.writeText(text.value).then(() => alert("✅ ก๊อปปี้แล้ว!"));
}