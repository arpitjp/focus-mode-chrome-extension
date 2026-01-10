// DOM Elements
const todayValue = document.getElementById('todayValue');
const weekValue = document.getElementById('weekValue');
const totalValue = document.getElementById('totalValue');
const chartPeriod = document.getElementById('chartPeriod');
const barChart = document.getElementById('barChart');
const avgDaily = document.getElementById('avgDaily');
const bestDay = document.getElementById('bestDay');
const focusDays = document.getElementById('focusDays');
const streak = document.getElementById('streak');
const viewTabs = document.querySelectorAll('.view-tab');
const backLink = document.getElementById('backLink');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const avgLine = document.getElementById('avgLine');
const chartAvg = document.getElementById('chartAvg');

let currentView = 'week';
let currentOffset = 0; // 0 = current period, -1 = previous period, etc.
let statsData = { daily: {}, totalMinutes: 0 };
let currentSessionMinutes = 0;
let earliestDataDate = null;

// Generate dummy data for testing (dev mode only)
async function loadDummyData() {
  const daily = {};
  let totalMinutes = 0;
  const today = new Date();
  
  // Generate data for last 60 days with realistic patterns
  for (let i = 0; i < 60; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    
    // Skip some days randomly (weekends have lower chance)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const skipChance = isWeekend ? 0.4 : 0.15;
    if (Math.random() < skipChance && i > 0) continue;
    
    // Generate focus time: 15-180 minutes, with some high-productivity days
    let minutes;
    const rand = Math.random();
    if (rand < 0.1) {
      // Exceptional day (10% chance)
      minutes = Math.floor(Math.random() * 120) + 180; // 180-300 min
    } else if (rand < 0.4) {
      // Good day (30% chance)
      minutes = Math.floor(Math.random() * 60) + 90; // 90-150 min
    } else {
      // Normal day (60% chance)
      minutes = Math.floor(Math.random() * 60) + 30; // 30-90 min
    }
    
    // Weekends are usually shorter
    if (isWeekend) {
      minutes = Math.floor(minutes * 0.6);
    }
    
    daily[dateKey] = minutes;
    totalMinutes += minutes;
  }
  
  const stats = { daily, totalMinutes };
  await chrome.storage.sync.set({ stats });
  console.log('🧪 Loaded dummy stats data:', Object.keys(daily).length, 'days,', totalMinutes, 'total minutes');
  return stats;
}

// Clear all data except blocked sites rules
async function clearDummyData() {
  await chrome.storage.sync.remove([
    'stats',
    'supportPrompt',
    'blockingEnabled',
    'blockingEndTime',
    'blockingDuration',
    'blockingStartTime',
    'lastDurationOption',
    'lastCustomMinutes'
  ]);
  await chrome.storage.local.remove([
    'blockingEnabled',
    'blockingEndTime',
    'blockingDuration',
    'blockingStartTime',
    'mutedByExtension'
  ]);
  console.log('🧹 Cleared all data (kept blocked sites)');
}

// Back link handler
backLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.close();
});

// Format time for display
function formatTime(minutes) {
  if (minutes === 0) return '0m';
  if (minutes < 60) {
    return `${minutes}m`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
}

// Format short time (for bar labels)
function formatShortTime(minutes) {
  if (minutes === 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

// Get date key
function getDateKey(date) {
  return date.toISOString().split('T')[0];
}

// Get day label (short)
function getDayLabel(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

// Get month label
function getMonthLabel(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[date.getMonth()];
}

// Format date range
function formatDateRange(startDate, endDate) {
  const startMonth = getMonthLabel(startDate);
  const endMonth = getMonthLabel(endDate);
  
  if (startMonth === endMonth) {
    return `${startMonth} ${startDate.getDate()} - ${endDate.getDate()}`;
  }
  return `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}`;
}

// Get minutes for a date (including current session if today)
function getMinutesForDate(dateKey) {
  const today = getDateKey(new Date());
  const stored = statsData.daily[dateKey] || 0;
  if (dateKey === today) {
    return stored + currentSessionMinutes;
  }
  return stored;
}

// Calculate current streak
function calculateStreak() {
  let streakCount = 0;
  const today = new Date();
  const todayKey = getDateKey(today);
  
  // Check if today has focus time (include current session)
  const todayMinutes = getMinutesForDate(todayKey);
  
  // Start from yesterday if today has no focus yet
  let checkDate = new Date(today);
  if (todayMinutes === 0) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  
  while (true) {
    const dateKey = getDateKey(checkDate);
    const minutes = getMinutesForDate(dateKey);
    
    if (minutes > 0) {
      streakCount++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  return streakCount;
}

// Calculate longest streak ever
function calculateLongestStreak() {
  const dates = Object.keys(statsData.daily).filter(d => statsData.daily[d] > 0).sort();
  if (dates.length === 0) {
    // Check if only today has data from current session
    const today = getDateKey(new Date());
    if (getMinutesForDate(today) > 0) return 1;
    return 0;
  }
  
  let longestStreak = 0;
  let currentStreak = 1;
  
  for (let i = 1; i < dates.length; i++) {
    const prevDate = new Date(dates[i - 1]);
    const currDate = new Date(dates[i]);
    
    // Check if consecutive days
    const diffDays = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      currentStreak++;
    } else {
      longestStreak = Math.max(longestStreak, currentStreak);
      currentStreak = 1;
    }
  }
  
  longestStreak = Math.max(longestStreak, currentStreak);
  
  // Check if today extends the streak (for current session)
  const today = getDateKey(new Date());
  const todayMinutes = getMinutesForDate(today);
  if (todayMinutes > 0 && dates.length > 0 && !dates.includes(today)) {
    const lastDate = new Date(dates[dates.length - 1]);
    const todayDate = new Date(today);
    const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      // Today continues the last streak, recalculate
      longestStreak = Math.max(longestStreak, calculateStreak());
    }
  }
  
  return longestStreak;
}

// Load stats data
async function loadStats() {
  try {
    const result = await chrome.storage.sync.get(['stats', 'blockingEnabled', 'blockingStartTime']);
    statsData = result.stats || { daily: {}, totalMinutes: 0 };
    
    // Calculate current session time if blocking is active
    currentSessionMinutes = 0;
    if (result.blockingEnabled && result.blockingStartTime) {
      currentSessionMinutes = Math.floor((Date.now() - result.blockingStartTime) / 60000);
    }
    
    // Find earliest date with data
    const dates = Object.keys(statsData.daily).sort();
    earliestDataDate = dates.length > 0 ? new Date(dates[0]) : null;
    
    updateSummary();
    updateChart();
    updateStats();
    updateNavButtons();
  } catch (e) {
    console.error('Error loading stats:', e);
  }
}

// Check if can navigate to previous period
function canGoBack() {
  if (!earliestDataDate) return false;
  
  const today = new Date();
  let checkDate = new Date(today);
  
  if (currentView === 'week') {
    checkDate.setDate(checkDate.getDate() - 7 * (Math.abs(currentOffset) + 1));
  } else if (currentView === 'month') {
    checkDate.setDate(checkDate.getDate() - 28 * (Math.abs(currentOffset) + 1));
  } else {
    checkDate.setMonth(checkDate.getMonth() - 12 * (Math.abs(currentOffset) + 1));
  }
  
  return checkDate >= earliestDataDate;
}

// Update navigation buttons state
function updateNavButtons() {
  prevBtn.disabled = !canGoBack();
  nextBtn.disabled = currentOffset >= 0;
}

// Update summary cards
function updateSummary() {
  const today = getDateKey(new Date());
  const todayMinutes = getMinutesForDate(today);
  
  // Calculate week total
  let weekTotal = 0;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  for (let d = new Date(weekAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
    weekTotal += getMinutesForDate(getDateKey(d));
  }
  
  const totalMinutes = (statsData.totalMinutes || 0) + currentSessionMinutes;
  
  todayValue.textContent = formatTime(todayMinutes);
  weekValue.textContent = formatTime(weekTotal);
  totalValue.textContent = formatTime(totalMinutes);
}

// Update bar chart
function updateChart() {
  const bars = [];
  const today = new Date();
  const realToday = new Date();
  let startDate, endDate;
  
  if (currentView === 'week') {
    // 7 days with offset
    endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (currentOffset * 7));
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    
    // Don't go beyond today
    if (endDate > realToday) endDate = new Date(realToday);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateKey = getDateKey(d);
      bars.push({
        label: getDayLabel(d),
        value: getMinutesForDate(dateKey),
        isToday: dateKey === getDateKey(realToday)
      });
    }
  } else if (currentView === 'month') {
    // 4 weeks with offset
    endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (currentOffset * 28));
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 27);
    
    if (endDate > realToday) endDate = new Date(realToday);
    
    for (let i = 0; i < 4; i++) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      let weekTotal = 0;
      for (let d = new Date(weekStart); d <= weekEnd && d <= realToday; d.setDate(d.getDate() + 1)) {
        weekTotal += getMinutesForDate(getDateKey(d));
      }
      
      const isCurrentWeek = currentOffset === 0 && i === 3;
      bars.push({
        label: `${getMonthLabel(weekStart).substring(0, 3)} ${weekStart.getDate()}`,
        value: weekTotal,
        isToday: isCurrentWeek
      });
    }
  } else if (currentView === 'year') {
    // 12 months with offset
    endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + (currentOffset * 12));
    startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 11);
    startDate.setDate(1);
    
    for (let i = 0; i < 12; i++) {
      const monthStart = new Date(startDate);
      monthStart.setMonth(monthStart.getMonth() + i);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);
      
      let monthTotal = 0;
      for (let d = new Date(monthStart); d <= monthEnd && d <= realToday; d.setDate(d.getDate() + 1)) {
        monthTotal += getMinutesForDate(getDateKey(d));
      }
      
      const isCurrentMonth = monthStart.getMonth() === realToday.getMonth() && 
                              monthStart.getFullYear() === realToday.getFullYear();
      bars.push({
        label: getMonthLabel(monthStart).substring(0, 3),
        value: monthTotal,
        isToday: isCurrentMonth
      });
    }
  }
  
  // Update period label
  if (currentView === 'week') {
    chartPeriod.textContent = formatDateRange(startDate, endDate);
  } else if (currentView === 'month') {
    const monthStart = getMonthLabel(startDate);
    const monthEnd = getMonthLabel(endDate);
    if (monthStart === monthEnd) {
      chartPeriod.textContent = `${monthStart} ${startDate.getFullYear()}`;
    } else {
      chartPeriod.textContent = `${monthStart} - ${monthEnd}`;
    }
  } else {
    chartPeriod.textContent = `${startDate.getFullYear()} - ${endDate.getFullYear()}`;
  }
  
  // Calculate average (excluding zeros for meaningful average)
  const nonZeroValues = bars.map(b => b.value).filter(v => v > 0);
  const avgValue = nonZeroValues.length > 0 
    ? Math.round(nonZeroValues.reduce((a, b) => a + b, 0) / nonZeroValues.length)
    : 0;
  
  // Find max for scaling
  const maxValue = Math.max(...bars.map(b => b.value), avgValue, 1);
  
  // Update average line position and label
  if (avgValue > 0) {
    const avgPercent = 100 - (avgValue / maxValue) * 100;
    avgLine.style.top = `calc(${avgPercent}% + 22px)`; // 22px accounts for value labels
    avgLine.style.display = 'block';
    chartAvg.textContent = `Avg: ${formatShortTime(avgValue)}`;
    chartAvg.style.display = 'block';
  } else {
    avgLine.style.display = 'none';
    chartAvg.style.display = 'none';
  }
  
  // Render bars
  barChart.innerHTML = bars.map(bar => {
    const heightPercent = (bar.value / maxValue) * 100;
    const barClass = bar.isToday ? 'bar today' : 'bar';
    const labelClass = bar.isToday ? 'bar-label today' : 'bar-label';
    
    return `
      <div class="bar-wrapper">
        <div class="bar-value">${formatShortTime(bar.value)}</div>
        <div class="bar-container">
          <div class="${barClass}" style="height: ${heightPercent}%"></div>
        </div>
        <div class="${labelClass}">${bar.label}</div>
      </div>
    `;
  }).join('');
  
  updateNavButtons();
}

// Update stats cards
function updateStats() {
  const today = getDateKey(new Date());
  
  // Calculate all-time stats
  let totalDays = 0;
  let bestDayMinutes = getMinutesForDate(today);
  
  for (const [date, minutes] of Object.entries(statsData.daily)) {
    if (minutes > 0) {
      totalDays++;
      const dateMinutes = getMinutesForDate(date);
      if (dateMinutes > bestDayMinutes) {
        bestDayMinutes = dateMinutes;
      }
    }
  }
  
  // Include today if it has minutes and not already counted
  const todayMinutes = getMinutesForDate(today);
  if (todayMinutes > 0 && !statsData.daily[today]) {
    totalDays++;
  }
  
  // Calculate weekly average (past 7 days only)
  let weekMinutes = 0;
  let weekDaysWithData = 0;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  for (const [date, minutes] of Object.entries(statsData.daily)) {
    if (new Date(date) >= weekAgo && minutes > 0) {
      weekMinutes += minutes;
      weekDaysWithData++;
    }
  }
  
  // Include today's current session if not already in daily
  if (todayMinutes > 0 && !statsData.daily[today]) {
    weekMinutes += currentSessionMinutes;
    weekDaysWithData++;
  } else if (statsData.daily[today]) {
    // Add current session minutes to today's stored value
    weekMinutes += currentSessionMinutes;
  }
  
  const avgMinutes = weekDaysWithData > 0 ? Math.round(weekMinutes / weekDaysWithData) : 0;
  
  // Calculate streaks
  const currentStreak = calculateStreak();
  const longestStreak = calculateLongestStreak();
  const isPersonalBest = currentStreak > 0 && currentStreak >= longestStreak;
  
  avgDaily.textContent = formatTime(avgMinutes);
  bestDay.textContent = formatTime(bestDayMinutes);
  focusDays.innerHTML = `${totalDays} <span>days</span>`;
  
  // Show streak with longest ever, and indicator if current is personal best
  if (isPersonalBest && currentStreak > 1) {
    streak.innerHTML = `${currentStreak} <span>days</span><span class="best-badge">· Best</span>`;
  } else if (longestStreak > currentStreak) {
    streak.innerHTML = `${currentStreak} <span>days</span><span class="longest-hint">· Best: ${longestStreak}</span>`;
  } else {
    streak.innerHTML = `${currentStreak} <span>days</span>`;
  }
}

// Tab switching
viewTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    viewTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentView = tab.dataset.view;
    currentOffset = 0; // Reset to current period when switching views
    updateChart();
  });
});

// Navigation buttons
prevBtn.addEventListener('click', () => {
  if (canGoBack()) {
    currentOffset--;
    updateChart();
  }
});

nextBtn.addEventListener('click', () => {
  if (currentOffset < 0) {
    currentOffset++;
    updateChart();
  }
});

// Listen for storage changes (for real-time updates)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && (changes.stats || changes.blockingEnabled || changes.blockingStartTime)) {
    loadStats();
  }
});

// Update current session time periodically
setInterval(() => {
  chrome.storage.sync.get(['blockingEnabled', 'blockingStartTime'], (result) => {
    if (result.blockingEnabled && result.blockingStartTime) {
      const newSessionMinutes = Math.floor((Date.now() - result.blockingStartTime) / 60000);
      if (newSessionMinutes !== currentSessionMinutes) {
        currentSessionMinutes = newSessionMinutes;
        updateSummary();
        updateChart();
        updateStats();
      }
    }
  });
}, 60000); // Update every minute

// Initialize
async function init() {
  // Check if in development mode
  const info = await chrome.management.getSelf();
  const isDev = info.installType === 'development';
  
  if (isDev) {
    // Add dev mode indicator and controls
    const devControls = document.createElement('div');
    devControls.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
      z-index: 1000;
    `;
    devControls.innerHTML = `
      <button id="loadDummyBtn" style="
        padding: 8px 12px;
        background: #22c55e;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      ">Load Dummy Data</button>
      <button id="clearDummyBtn" style="
        padding: 8px 12px;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      ">Clear Data</button>
    `;
    document.body.appendChild(devControls);
    
    document.getElementById('loadDummyBtn').addEventListener('click', async () => {
      await loadDummyData();
      loadStats();
    });
    
    document.getElementById('clearDummyBtn').addEventListener('click', async () => {
      await clearDummyData();
      loadStats();
    });
    
    console.log('🧪 Dev mode: Use buttons to load/clear dummy data');
  }
  
  loadStats();
}

init();
