import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import data from './skills.json';
const skills = data.skills;
const generatedAt = data.generatedAt;
const GROUPS = [
    { id: 'all', label: '全部', match: () => true },
    { id: 'hot', label: '常用 (近期)', match: (s) => s.usageCount >= 3 },
    { id: 'unused', label: '从未使用', match: (s) => s.usageCount === 0 },
    { id: 'meta', label: '元 / 工具类', match: (s) => /skill|create|forge|update|init|nuwa/i.test(s.name) },
    { id: 'meituan', label: '美团内部', match: (s) => /(meituan|dx|km|citadel|mrn|bi-|pde|aihot|decision|webauto|ldh|daxiang)/i.test(s.name) },
    { id: 'design', label: '设计 / UI', match: (s) => /(design|ui|banner|brand|slides|architecture|icon)/i.test(s.name) },
    { id: 'life', label: '生活场景', match: (s) => /(团建|聚餐|外卖|搬家|购物|旅游|周边|健身|预约|City|手艺|找优惠|taobao)/i.test(s.name) },
];
function highlight(text, query) {
    if (!query)
        return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1)
        return text;
    return (_jsxs(_Fragment, { children: [text.slice(0, idx), _jsx("mark", { children: text.slice(idx, idx + query.length) }), text.slice(idx + query.length)] }));
}
export default function App() {
    const [group, setGroup] = useState('all');
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(skills[0]?.name ?? null);
    const [present, setPresent] = useState(false);
    const [copied, setCopied] = useState(false);
    const inputRef = useRef(null);
    const fuse = useMemo(() => new Fuse(skills, {
        keys: [
            { name: 'name', weight: 0.4 },
            { name: 'description', weight: 0.4 },
            { name: 'triggers', weight: 0.2 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
    }), []);
    const filtered = useMemo(() => {
        let list = skills.filter((s) => GROUPS.find((g) => g.id === group).match(s));
        if (query.trim()) {
            const found = new Set(fuse.search(query.trim()).map((r) => r.item.name));
            list = list.filter((s) => found.has(s.name));
        }
        return list;
    }, [group, query, fuse]);
    const current = skills.find((s) => s.name === selected) ?? filtered[0];
    useEffect(() => {
        const handler = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.select();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
                e.preventDefault();
                setPresent((p) => !p);
            }
            if (e.key === 'Escape') {
                setPresent(false);
                if (document.activeElement === inputRef.current) {
                    inputRef.current?.blur();
                    setQuery('');
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
    const copy = (cmd) => {
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };
    const groupCounts = GROUPS.map((g) => ({ ...g, count: skills.filter(g.match).length }));
    return (_jsxs("div", { className: `app${present ? ' present' : ''}`, children: [_jsxs("aside", { className: "sidebar", children: [_jsx("h1", { children: "Skillbox" }), groupCounts.map((g) => (_jsxs("button", { className: group === g.id ? 'active' : '', onClick: () => setGroup(g.id), children: [_jsx("span", { children: g.label }), _jsx("span", { className: "count", children: g.count })] }, g.id))), _jsx("div", { className: "group", style: { marginTop: 24 }, children: "\u5FEB\u6377\u952E" }), _jsxs("div", { style: { padding: '4px 10px', color: 'var(--muted)', fontSize: 12 }, children: ["\u2318K \u641C\u7D22", _jsx("br", {}), "\u2318D \u6F14\u793A\u6A21\u5F0F", _jsx("br", {}), "Esc \u9000\u51FA"] }), _jsx("div", { className: "group", style: { marginTop: 24 }, children: "\u6570\u636E" }), _jsxs("div", { style: { padding: '4px 10px', color: 'var(--muted)', fontSize: 11 }, children: [skills.length, " \u4E2A skill", _jsx("br", {}), new Date(generatedAt).toLocaleString('zh-CN')] })] }), _jsxs("section", { className: "list-pane", children: [_jsxs("div", { className: "search-wrap", children: [_jsx("input", { ref: inputRef, value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u641C\u7D22\uFF1A\u6280\u80FD\u540D\u3001\u63CF\u8FF0\u3001\u89E6\u53D1\u8BCD\u2026\u2026  \u2318K" }), _jsxs("div", { className: "search-meta", children: [filtered.length, " / ", skills.length, " \u4E2A\u5339\u914D"] })] }), _jsxs("div", { className: "cards", children: [filtered.map((s) => (_jsxs("div", { className: `card${current?.name === s.name ? ' selected' : ''}${s.usageCount === 0 ? ' unused' : ''}`, onClick: () => setSelected(s.name), children: [_jsxs("div", { className: "row1", children: [_jsx("h3", { children: highlight(s.name, query) }), s.usageCount > 0 ? (_jsxs("span", { className: "badge hot", children: [s.usageCount, "\u00D7"] })) : (_jsx("span", { className: "badge", children: "\u672A\u7528" }))] }), _jsx("p", { children: highlight(s.description, query) })] }, s.name))), filtered.length === 0 && (_jsx("div", { className: "empty", children: "\u6CA1\u6709\u5339\u914D\u7684 skill" }))] })] }), _jsx("section", { className: "detail-pane", children: current ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "head", children: [_jsx("h2", { children: current.name }), _jsx("button", { className: `copy${copied ? ' copied' : ''}`, onClick: () => copy(`/${current.name}`), title: "\u590D\u5236 slash \u547D\u4EE4", children: copied ? '✓ 已复制' : `/${current.name}` })] }), _jsxs("div", { className: "meta", children: [_jsxs("span", { children: ["\uD83D\uDCE6 ", (current.bytes / 1024).toFixed(1), " KB"] }), _jsxs("span", { children: ["\uD83D\uDD25 \u8C03\u7528 ", current.usageCount, " \u6B21"] }), current.triggers.length > 0 && (_jsxs("span", { children: ["\uD83C\uDFAF \u89E6\u53D1\u8BCD ", current.triggers.length, " \u4E2A"] }))] }), _jsx("div", { className: "desc", children: current.description }), _jsx("div", { className: "body", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm], children: current.body }) })] })) : (_jsx("div", { className: "empty", children: "\u9009\u4E00\u4E2A skill" })) })] }));
}
