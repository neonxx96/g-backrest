import React, { useState, useRef, useEffect } from 'react';
import { COLOR_CHANNELS, useColorLinksStore } from '../../stores/colorLinksStore';
import { Link2, Unlink } from 'lucide-react';

/**
 * Reusable Color Channel Selector for panel headers.
 * Allows binding a panel to c1..c10 or unlinking it ('none').
 */
export default function ChannelSelector({ panelId }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const currentChannel = useColorLinksStore((s) => s.panelBindings[panelId] || null);
  const setPanelChannel = useColorLinksStore((s) => s.setPanelChannel);

  const activeChannelConfig = COLOR_CHANNELS.find((c) => c.id === currentChannel);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        data-testid={`channel-selector-${panelId}`}
        onClick={() => setIsOpen((v) => !v)}
        title={
          activeChannelConfig
            ? `Привязка к каналу ${activeChannelConfig.id.toUpperCase()} (${activeChannelConfig.name})`
            : 'Без цвета (независимый символ)'
        }
        className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition cursor-pointer select-none"
        style={{
          backgroundColor: activeChannelConfig ? activeChannelConfig.bg : 'rgba(255,255,255,0.05)',
          borderColor: activeChannelConfig ? activeChannelConfig.border : '#2a2e39',
          color: activeChannelConfig ? activeChannelConfig.color : '#787f91'
        }}
      >
        {activeChannelConfig ? (
          <>
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: activeChannelConfig.color }}
            />
            <span>{activeChannelConfig.id.toUpperCase()}</span>
          </>
        ) : (
          <>
            <Unlink size={10} className="text-[#64748b]" />
            <span className="text-[9px] text-[#64748b]">НЕТ</span>
          </>
        )}
      </button>

      {isOpen && (
        <div
          data-testid={`channel-dropdown-${panelId}`}
          className="absolute right-0 top-full mt-1 w-36 bg-[#0e121a] border border-[#222838] rounded shadow-2xl p-1 z-50 text-[10px] space-y-0.5 font-mono"
        >
          <div className="px-1.5 py-1 text-[9px] text-[#64748b] border-b border-[#1b202e] flex items-center justify-between">
            <span>Цветовая связка</span>
            <Link2 size={10} />
          </div>

          {/* Unlink option */}
          <button
            type="button"
            onClick={() => {
              setPanelChannel(panelId, null);
              setIsOpen(false);
            }}
            className={`w-full flex items-center space-x-2 px-1.5 py-1 rounded text-left hover:bg-[#161c28] transition ${
              !currentChannel ? 'bg-[#1a2333] text-white font-bold' : 'text-[#94a3b8]'
            }`}
          >
            <Unlink size={11} className="text-[#64748b]" />
            <span>Без цвета (свой)</span>
          </button>

          {/* 10 Color channels */}
          <div className="grid grid-cols-2 gap-0.5 pt-0.5">
            {COLOR_CHANNELS.map((ch) => {
              const isSelected = currentChannel === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  data-testid={`channel-option-${panelId}-${ch.id}`}
                  onClick={() => {
                    setPanelChannel(panelId, ch.id);
                    setIsOpen(false);
                  }}
                  className={`flex items-center space-x-1.5 px-1.5 py-1 rounded text-left hover:bg-[#182030] transition cursor-pointer ${
                    isSelected ? 'bg-[#1c283f] font-bold' : ''
                  }`}
                  style={{ color: ch.color }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/30"
                    style={{ backgroundColor: ch.color }}
                  />
                  <span className="text-[9.5px]">{ch.id.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
