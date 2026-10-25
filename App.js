import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, Alert,
  StatusBar, Dimensions, Animated, Easing, BackHandler,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'habits_v1';
const BLUE = '#2563FF';
const COLORS = ['#4F8BFF', '#22C55E', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#A855F7'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const SCREEN_W = Dimensions.get('window').width;

/* ---------------- date helpers ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };

function streakOf(done) {
  let n = 0;
  let i = done[keyOf(daysAgo(0))] ? 0 : 1;
  while (done[keyOf(daysAgo(i))]) { n++; i++; }
  return n;
}

// How many days the habit "existed", how many were done, percent, best streak.
// Today counts only after you mark it (so an unfinished today never lowers the %).
function statsOf(h, today) {
  const keys = Object.keys(h.done).filter((k) => k <= today).sort();
  const start = [h.created, keys[0]].filter(Boolean).sort()[0] || today;
  const end = h.done[today] ? today : keyOf(daysAgo(1));
  const total = end >= start ? diffDays(start, end) + 1 : 0;
  const done = keys.filter((k) => k >= start && k <= end).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  let best = 0, run = 0;
  for (let i = 0; i < total; i++) {
    if (h.done[addDays(start, i)]) { run++; best = Math.max(best, run); } else run = 0;
  }
  return { start, total, done, percent, best };
}

/* ---------------- visual building blocks ---------------- */

// Smooth gradient background: bright blue corner melting into near-black.
function Background() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#05060B' }]} />
      <LinearGradient
        colors={[
          'rgba(92,134,255,0.95)', 'rgba(52,100,250,0.80)', 'rgba(30,64,200,0.55)',
          'rgba(16,34,120,0.32)', 'rgba(8,16,60,0.14)', 'rgba(5,6,11,0)',
        ]}
        locations={[0, 0.1, 0.24, 0.4, 0.58, 0.85]}
        start={{ x: 0.85, y: 0 }}
        end={{ x: 0.3, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

// "Glass" surface: translucent fill + bright rim + soft top highlight.
function Glass({ style, radius = 22, children }) {
  return (
    <View style={[{
      borderRadius: radius, overflow: 'hidden', borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.20)', backgroundColor: 'rgba(255,255,255,0.07)',
    }, style]}>
      <LinearGradient
        colors={['rgba(255,255,255,0.20)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0.07)']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill} pointerEvents="none"
      />
      {children}
    </View>
  );
}

// Pressable that squishes a little when touched.
function Press({ onPress, onLongPress, style, disabled, children }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 7 }).start();
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => to(0.95)} onPressOut={() => to(1)}
      onPress={onPress} onLongPress={onLongPress}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Fade + slide-up on mount.
function FadeIn({ delay = 0, style, children }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 450, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

function PrimaryButton({ title, onPress, disabled }) {
  return (
    <Press onPress={onPress} disabled={disabled} style={[styles.bigBtn, disabled && { opacity: 0.4 }]}>
      <LinearGradient colors={['#6B98FF', '#2563FF']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} style={styles.bigBtnShine} />
      <Text style={styles.bigBtnText}>{title}</Text>
    </Press>
  );
}

function RoundGlassButton({ label, onPress }) {
  return (
    <Press onPress={onPress}>
      <Glass radius={22} style={styles.roundBtn}><Text style={styles.roundBtnText}>{label}</Text></Glass>
    </Press>
  );
}

function CheckButton({ done, color, onPress }) {
  const s = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    Animated.sequence([
      Animated.timing(s, { toValue: 1.35, duration: 120, useNativeDriver: true }),
      Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 14 }),
    ]).start();
  }, [done]);
  return (
    <Pressable onPress={onPress} hitSlop={10}>
      <Animated.View style={[
        styles.check, { borderColor: color }, done && { backgroundColor: color },
        { transform: [{ scale: s }] },
      ]}>
        {done && <Text style={styles.checkMark}>✓</Text>}
      </Animated.View>
    </Pressable>
  );
}

/* ---------------- month calendar (read-only) ---------------- */
function MonthCalendar({ today, getBg, selected, onSelect }) {
  const [shift, setShift] = useState(0);
  const base = new Date();
  const view = new Date(base.getFullYear(), base.getMonth() + shift, 1);
  const y = view.getFullYear();
  const m = view.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const total = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(`${y}-${pad(m + 1)}-${pad(d)}`);

  return (
    <View>
      <View style={styles.monthRow}>
        <RoundGlassButton label="‹" onPress={() => setShift(shift - 1)} />
        <Text style={styles.monthText}>{MONTHS[m]} {y}</Text>
        <View style={shift >= 0 && { opacity: 0.25 }}>
          <RoundGlassButton label="›" onPress={() => setShift(Math.min(0, shift + 1))} />
        </View>
      </View>
      <View style={styles.grid}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
          <View key={'h' + i} style={styles.cellOuter}><Text style={styles.weekHead}>{l}</Text></View>
        ))}
        {cells.map((k, i) => (
          <View key={i} style={styles.cellOuter}>
            {k ? (
              <Pressable onPress={() => onSelect && onSelect(k)}>
                <View style={[
                  styles.cell,
                  { backgroundColor: k > today ? 'transparent' : getBg(k) },
                  k === today && { borderWidth: 1.5, borderColor: '#8FB0FF' },
                  k === selected && { borderWidth: 2, borderColor: '#fff' },
                ]}>
                  <Text style={[styles.cellText, k > today && { color: 'rgba(255,255,255,0.22)' }]}>
                    {parseInt(k.slice(8), 10)}
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------- Habits tab ---------------- */
function HabitCard({ h, today, index, onOpen, onToggle, onDelete }) {
  return (
    <FadeIn delay={index * 80}>
      <Press onPress={onOpen} onLongPress={onDelete} style={{ marginBottom: 14 }}>
        <Glass radius={28} style={{ padding: 16 }}>
          <View style={styles.row}>
            <CheckButton done={!!h.done[today]} color={h.color} onPress={onToggle} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{h.name}</Text>
              <Text style={styles.streak}>🔥 {streakOf(h.done)} day streak</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
          <View style={styles.week}>
            {[6, 5, 4, 3, 2, 1, 0].map((i) => {
              const d = daysAgo(i);
              const k = keyOf(d);
              return (
                <View key={k} style={styles.dayWrap}>
                  <Text style={styles.dayLabel}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()]}</Text>
                  <View style={[
                    styles.dot,
                    h.done[k] && { backgroundColor: h.color },
                    k === today && { borderWidth: 2, borderColor: '#fff' },
                  ]} />
                </View>
              );
            })}
          </View>
        </Glass>
      </Press>
    </FadeIn>
  );
}

function HabitsScreen({ habits, today, toggleToday, remove, open }) {
  const doneToday = habits.filter((h) => h.done[today]).length;
  const now = new Date();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
      <Text style={styles.hero}>Own Your Habits,</Text>
      <Text style={styles.hero}>Shape <Text style={{ color: '#9DBBFF' }}>Your Life.</Text></Text>
      <Text style={styles.subtitle}>
        {now.getDate()} {MONTHS[now.getMonth()]} · {doneToday} of {habits.length} done today
      </Text>
      {habits.length === 0 && (
        <Text style={styles.empty}>No habits yet. Tap “Add” below to create your first one.</Text>
      )}
      {habits.map((h, i) => (
        <HabitCard
          key={h.id} h={h} today={today} index={i}
          onOpen={() => open(h.id)}
          onToggle={() => toggleToday(h.id)}
          onDelete={() => remove(h)}
        />
      ))}
      {habits.length > 0 && (
        <Text style={styles.hint}>Tap a habit for details. Only today can be marked.</Text>
      )}
    </ScrollView>
  );
}

/* ---------------- Calendar tab ---------------- */
function CalendarScreen({ habits, today }) {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(today);
  const current = habits.find((h) => h.id === filter);
  const existingOn = (k) => habits.filter((h) => !h.created || h.created <= k);

  const getBg = (k) => {
    if (filter === 'all') {
      const ex = existingOn(k);
      const done = ex.filter((h) => h.done[k]).length;
      const ratio = ex.length ? done / ex.length : 0;
      return ratio === 0 ? 'rgba(255,255,255,0.07)' : `rgba(60,120,255,${0.3 + 0.7 * ratio})`;
    }
    return current && current.done[k] ? current.color : 'rgba(255,255,255,0.07)';
  };

  const selHabits = existingOn(selected);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
      <Text style={styles.hero}>Calendar</Text>
      <Text style={styles.subtitle}>History is read-only</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        {[{ id: 'all', name: 'All' }, ...habits].map((h) => (
          <Press key={h.id} onPress={() => setFilter(h.id)} style={{ marginRight: 8 }}>
            <Glass radius={20} style={[{ paddingHorizontal: 16, paddingVertical: 9 },
              filter === h.id && { backgroundColor: 'rgba(37,99,255,0.75)', borderColor: 'rgba(255,255,255,0.45)' }]}>
              <Text style={styles.chipText}>{h.name}</Text>
            </Glass>
          </Press>
        ))}
      </ScrollView>

      <Glass radius={28} style={{ padding: 14 }}>
        <MonthCalendar today={today} getBg={getBg} selected={selected} onSelect={setSelected} />
      </Glass>

      <Glass radius={28} style={{ padding: 16, marginTop: 14 }}>
        <Text style={styles.name}>{selected === today ? 'Today' : selected}</Text>
        {selected > today ? (
          <Text style={styles.streak}>This day hasn't come yet.</Text>
        ) : selHabits.length === 0 ? (
          <Text style={styles.streak}>No habits on this day.</Text>
        ) : (
          selHabits.map((h) => (
            <View key={h.id} style={styles.detailRow}>
              <View style={[styles.miniDot, { backgroundColor: h.color }]} />
              <Text style={styles.detailName}>{h.name}</Text>
              <Text style={{ color: h.done[selected] ? '#4ADE80' : 'rgba(255,255,255,0.4)', fontWeight: '700' }}>
                {h.done[selected] ? 'Done' : 'Missed'}
              </Text>
            </View>
          ))
        )}
      </Glass>
    </ScrollView>
  );
}

/* ---------------- Add tab ---------------- */
function AddScreen({ onCreate }) {
  const [text, setText] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const create = () => {
    const name = text.trim();
    if (!name) return;
    onCreate(name, color);
    setText('');
  };
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Text style={styles.hero}>New habit</Text>
      <Text style={styles.subtitle}>Start small. Do it every day.</Text>

      <Glass radius={24}>
        <TextInput
          style={styles.input}
          placeholder="e.g. Read 10 pages"
          placeholderTextColor="rgba(255,255,255,0.4)"
          value={text}
          onChangeText={setText}
          onSubmitEditing={create}
        />
      </Glass>

      <Text style={styles.label}>Color</Text>
      <View style={styles.colorRow}>
        {COLORS.map((c) => (
          <Press key={c} onPress={() => setColor(c)}>
            <View style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotOn]} />
          </Press>
        ))}
      </View>

      <PrimaryButton title="Create habit" onPress={create} disabled={!text.trim()} />
    </View>
  );
}

/* ---------------- Habit detail window ---------------- */
function DetailScreen({ habit, today, onClose, onDelete }) {
  const slide = useRef(new Animated.Value(SCREEN_W)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const st = statsOf(habit, today);

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  useEffect(() => {
    Animated.timing(bar, { toValue: st.percent, duration: 900, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [st.percent]);

  const close = () => {
    Animated.timing(slide, { toValue: SCREEN_W, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onClose);
  };

  const getBg = (k) => {
    if (habit.done[k]) return habit.color;
    if (k >= st.start && k < today) return 'rgba(239,68,68,0.32)'; // missed
    return 'rgba(255,255,255,0.07)';
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: slide }] }]}>
      <Background />
      <ScrollView
        contentContainerStyle={{ paddingTop: (StatusBar.currentHeight || 40) + 16, paddingHorizontal: 16, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailHeader}>
          <RoundGlassButton label="‹" onPress={close} />
          <Text style={[styles.hero, { flex: 1, fontSize: 26, lineHeight: 32, marginHorizontal: 12 }]} numberOfLines={1}>
            {habit.name}
          </Text>
          <RoundGlassButton label="🗑" onPress={onDelete} />
        </View>

        <FadeIn delay={80}>
          <View style={styles.statsRow}>
            {[
              { v: `🔥 ${streakOf(habit.done)}`, l: 'Streak' },
              { v: `${st.best}`, l: 'Best' },
              { v: `${st.done}`, l: 'Done' },
            ].map((s) => (
              <Glass key={s.l} radius={22} style={styles.statBox}>
                <Text style={styles.statValue}>{s.v}</Text>
                <Text style={styles.statLabel}>{s.l}</Text>
              </Glass>
            ))}
          </View>
        </FadeIn>

        <FadeIn delay={160}>
          <Glass radius={28} style={{ padding: 14, marginTop: 14 }}>
            <MonthCalendar today={today} getBg={getBg} />
            <View style={styles.legend}>
              <View style={[styles.legendBox, { backgroundColor: habit.color }]} /><Text style={styles.legendText}>Done</Text>
              <View style={[styles.legendBox, { backgroundColor: 'rgba(239,68,68,0.45)', marginLeft: 16 }]} /><Text style={styles.legendText}>Missed</Text>
            </View>
          </Glass>
        </FadeIn>

        <FadeIn delay={240}>
          <Glass radius={28} style={{ padding: 18, marginTop: 14 }}>
            <Text style={styles.statLabel}>Completion rate</Text>
            <Text style={styles.percent}>{st.percent}%</Text>
            <View style={styles.barTrack}>
              <Animated.View style={[styles.barFill, {
                backgroundColor: habit.color,
                width: bar.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
              }]} />
            </View>
            <Text style={styles.percentNote}>
              {st.total === 0
                ? 'Mark today to start your stats.'
                : `${st.total} ${st.total === 1 ? 'day' : 'days'} tracked, ${st.done} done`}
            </Text>
          </Glass>
        </FadeIn>
      </ScrollView>
    </Animated.View>
  );
}

/* ---------------- Bottom tab bar ---------------- */
function TabBar({ tab, setTab, tabs }) {
  const tabW = (SCREEN_W - 32 - 12) / tabs.length;
  const x = useRef(new Animated.Value(0)).current;
  const idx = tabs.findIndex((t) => t.id === tab);
  useEffect(() => {
    Animated.spring(x, { toValue: idx * tabW, useNativeDriver: true, bounciness: 9, speed: 14 }).start();
  }, [idx]);
  return (
    <Glass radius={36} style={styles.tabBar}>
      <View style={{ flexDirection: 'row', padding: 6 }}>
        <Animated.View style={[styles.indicator, { width: tabW, transform: [{ translateX: x }] }]}>
          <LinearGradient colors={['#6B98FF', '#2563FF']} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} style={styles.indicatorShine} />
        </Animated.View>
        {tabs.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ width: tabW, height: 58, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[styles.tabIcon, tab !== t.id && { opacity: 0.6 }]}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab !== t.id && { opacity: 0.6 }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </Glass>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  const [habits, setHabits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('habits');
  const [openId, setOpenId] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (v) setHabits(JSON.parse(v)); })
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
  }, [habits, loaded]);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000); // refresh "today" after midnight
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openId) { setOpenId(null); return true; }
      if (tab !== 'habits') { setTab('habits'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [openId, tab]);

  const today = keyOf(new Date());

  const createHabit = (name, color) => {
    setHabits((hs) => [...hs, { id: Date.now().toString(), name, color, done: {}, created: keyOf(new Date()) }]);
    setTab('habits');
  };

  // The ONLY place a mark can change - and only for today.
  const toggleToday = (id) => {
    const k = keyOf(new Date());
    setHabits((hs) => hs.map((h) => {
      if (h.id !== id) return h;
      const done = { ...h.done };
      if (done[k]) delete done[k]; else done[k] = true;
      return { ...h, done };
    }));
  };

  const remove = (h) => {
    Alert.alert('Delete habit', `Delete "${h.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => { setOpenId(null); setHabits((hs) => hs.filter((x) => x.id !== h.id)); },
      },
    ]);
  };

  const tabs = [
    { id: 'habits', icon: '✅', label: 'Habits' },
    { id: 'calendar', icon: '📅', label: 'Calendar' },
    { id: 'add', icon: '➕', label: 'Add' },
  ];
  const openHabit = habits.find((h) => h.id === openId);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <Background />
      <View style={{ flex: 1, paddingTop: (StatusBar.currentHeight || 40) + 16 }}>
        <FadeIn key={tab} style={{ flex: 1 }}>
          {tab === 'habits' && (
            <HabitsScreen habits={habits} today={today} toggleToday={toggleToday} remove={remove} open={setOpenId} />
          )}
          {tab === 'calendar' && <CalendarScreen habits={habits} today={today} />}
          {tab === 'add' && <AddScreen onCreate={createHabit} />}
        </FadeIn>
      </View>
      <TabBar tab={tab} setTab={setTab} tabs={tabs} />
      {openHabit && (
        <DetailScreen
          key={openHabit.id}
          habit={openHabit}
          today={today}
          onClose={() => setOpenId(null)}
          onDelete={() => remove(openHabit)}
        />
      )}
    </View>
  );
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05060B' },
  hero: { color: '#fff', fontSize: 34, fontWeight: '700', lineHeight: 42, letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 8, marginBottom: 22 },
  empty: { color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 40, fontSize: 15, paddingHorizontal: 20 },
  hint: { color: 'rgba(255,255,255,0.35)', textAlign: 'center', fontSize: 12, paddingVertical: 8 },

  row: { flexDirection: 'row', alignItems: 'center' },
  check: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 19 },
  name: { color: '#fff', fontSize: 18, fontWeight: '600' },
  streak: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 3 },
  chevron: { color: 'rgba(255,255,255,0.4)', fontSize: 28, marginLeft: 8 },
  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  dayWrap: { alignItems: 'center', width: 36 },
  dayLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 6 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.10)' },

  chipText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  roundBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  roundBtnText: { color: '#fff', fontSize: 24, marginTop: -2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellOuter: { width: '14.2857%', padding: 3 },
  weekHead: { color: 'rgba(255,255,255,0.45)', textAlign: 'center', fontSize: 12, marginBottom: 2 },
  cell: { aspectRatio: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cellText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  detailRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  miniDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  detailName: { flex: 1, color: '#fff', fontSize: 15 },

  input: { color: '#fff', paddingHorizontal: 20, paddingVertical: 16, fontSize: 17 },
  label: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 24, marginBottom: 12 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  colorDot: { width: 40, height: 40, borderRadius: 20, marginRight: 12, marginBottom: 12, borderWidth: 3, borderColor: 'transparent' },
  colorDotOn: { borderColor: '#fff' },
  bigBtn: { marginTop: 14, borderRadius: 30, paddingVertical: 17, alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  bigBtnShine: { position: 'absolute', left: 0, right: 0, top: 0, height: '55%' },
  bigBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  detailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statBox: { flex: 1, marginHorizontal: 4, paddingVertical: 14, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '700' },
  statLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 4 },
  legend: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingLeft: 4 },
  legendBox: { width: 14, height: 14, borderRadius: 4, marginRight: 6 },
  legendText: { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  percent: { color: '#fff', fontSize: 48, fontWeight: '800', marginTop: 2, letterSpacing: -1 },
  barTrack: { height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginTop: 8 },
  barFill: { height: 12, borderRadius: 6 },
  percentNote: { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 12 },

  tabBar: { position: 'absolute', left: 16, right: 16, bottom: 28 },
  indicator: { position: 'absolute', left: 6, top: 6, height: 58, borderRadius: 30, overflow: 'hidden' },
  indicatorShine: { position: 'absolute', left: 0, right: 0, top: 0, height: '55%' },
  tabIcon: { fontSize: 20 },
  tabLabel: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 2 },
});
