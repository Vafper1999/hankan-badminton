let playerCount = 0;
function addPlayer(name = '', hours = 1) {
    playerCount++;
    const id = `player_${playerCount}`;
    const div = document.createElement('div');
    div.className = 'player-row';
    div.id = id;
    
    div.innerHTML = `
        <input type="text" class="p-name" placeholder="ชื่อ" value="${name}" oninput="updateReceiverList()">
        <input type="number" class="p-hours" placeholder="ชม." value="${hours}" step="0.5">
        <label class="checkbox-group">
            <input type="checkbox" class="p-shuttle"> จ่ายค่าลูกไปก่อน
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
    
    select.innerHTML = '<option value="external">-- คนนอก (ไม่ได้เล่นด้วย) --</option>';
    
    const names = document.querySelectorAll('.p-name');
    names.forEach((input, index) => {
        const name = input.value.trim();
        if (name) {
            const option = document.createElement('option');
            option.value = index.toString();
            option.textContent = name;
            select.appendChild(option);
        }
    });

    // พยายามเซ็ตค่าเดิมกลับถ้ายังมีอยู่
    if(Array.from(select.options).some(opt => opt.value === currentVal)) {
        select.value = currentVal;
    }
}

function calculate() {
    // 1. ดึงข้อมูลตั้งต้น
    const courtPrice = parseFloat(document.getElementById('courtPrice').value) || 0;
    const courtHours = parseFloat(document.getElementById('courtHours').value) || 0;
    const shuttlePrice = parseFloat(document.getElementById('shuttlePrice').value) || 0;
    const shuttleCount = parseFloat(document.getElementById('shuttleCount').value) || 0;
    
    const totalCourt = courtPrice * courtHours;
    const totalShuttle = shuttlePrice * shuttleCount;
    const totalCost = totalCourt + totalShuttle;

    // 2. ดึงข้อมูลคนเล่น
    const rows = document.querySelectorAll('.player-row');
    let players = [];
    let totalPlayerHours = 0;
    let shuttlePayerCount = 0;

    rows.forEach((row, index) => {
        const name = row.querySelector('.p-name').value.trim() || `คนที่ ${index+1}`;
        const hours = parseFloat(row.querySelector('.p-hours').value) || 0;
        const paidShuttle = row.querySelector('.p-shuttle').checked;

        totalPlayerHours += hours;
        if(paidShuttle) shuttlePayerCount++;

        players.push({ id: index.toString(), name, hours, paidShuttle });
    });

    if (totalPlayerHours === 0) {
        alert("กรุณาใส่จำนวนชั่วโมงคนเล่นให้ถูกต้อง");
        return;
    }

    // 3. คำนวณตัวแปรหลัก
    const ratePerHour = totalCost / totalPlayerHours;
    const shuttlePrepaidPerPerson = shuttlePayerCount > 0 ? totalShuttle / shuttlePayerCount : 0;
    const receiverId = document.getElementById('receiverSelect').value;

    // 4. คำนวณรายคน
    const tbody = document.querySelector('#resultTable tbody');
    tbody.innerHTML = '';
    let summaryTextArray = [];

    players.forEach(p => {
        const share = p.hours * ratePerHour;
        const prepaid = p.paidShuttle ? shuttlePrepaidPerPerson : 0;
        let net = share - prepaid;

        let statusText = "";
        let isReceiver = (p.id === receiverId);

        if (isReceiver) {
            statusText = "(คนรับเงิน)";
        } else {
            statusText = net > 0 ? net.toFixed(2) : "0.00";
        }

        // สร้างแถวตาราง
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p.name}</td>
            <td>${p.hours}</td>
            <td>${share.toFixed(2)}</td>
            <td>${prepaid > 0 ? '-' + prepaid.toFixed(2) : '0'}</td>
            <td><strong>${statusText}</strong></td>
        `;
        tbody.appendChild(tr);

        // เก็บข้อความสรุป
        if (!isReceiver) {
            summaryTextArray.push(`- ${p.name}: ${net > 0 ? net.toFixed(2) : '0'} บ.`);
        }
    });

    // 5. สร้างข้อความสรุป
    const bankName = document.getElementById('bankName').value.trim() || '-';
    const bankAcc = document.getElementById('bankAccount').value.trim() || '-';
    let receiverName = "คนรับเงิน";
    
    if (receiverId !== "external") {
        const rPlayer = players.find(p => p.id === receiverId);
        if(rPlayer) receiverName = rPlayer.name;
    }

    let summary = `🏸 สรุปค่าแบดมินตัน\n`;
    summary += `ยอดรวมทั้งหมด: ${totalCost} บาท\n`;
    summary += `(คอร์ท ${totalCourt} บ. / ลูก ${totalShuttle} บ.)\n`;
    summary += `----------------------\n`;
    summary += `💸 ยอดที่ต้องโอน:\n`;
    summary += summaryTextArray.join('\n') + `\n`;
    summary += `----------------------\n`;
    summary += `🏦 โอนให้: ${receiverName}\n`;
    summary += `ธนาคาร/พร้อมเพย์: ${bankName}\n`;
    summary += `เลขบัญชี: ${bankAcc}\n`;

    document.getElementById('summaryText').value = summary;
    document.getElementById('resultSection').classList.remove('hidden');
}

function copyText() {
    const text = document.getElementById('summaryText');
    text.select();
    navigator.clipboard.writeText(text.value).then(() => {
        alert("✅ ก๊อปปี้ข้อความเรียบร้อยแล้ว!");
    });
}