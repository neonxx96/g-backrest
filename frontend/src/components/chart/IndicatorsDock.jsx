import React from 'react';
import ActiveIndicatorStack from '../indicators/ActiveIndicatorStack';
import IndicatorsModal from '../indicators/IndicatorsModal';
import IndicatorSettingsDialog from '../indicators/IndicatorSettingsDialog';

// Док индикаторов панели: стек активных пилюль + каталог + диалог настроек.
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4o, п.1 MODULARIZATION_PLAN):
// JSX и пропсы перенесены без изменений.
// Пропсы: activeIndicators, setSettingsDialogIndId/settingsDialogIndId (state
// Chart.jsx), handleToggleVisibility/handleRemoveIndicator/handleAddIndicator/
// handleSaveSettings (useChartIndicators), setIsCatalogOpen/isCatalogOpen.

export default function IndicatorsDock({
  activeIndicators,
  settingsDialogIndId,
  setSettingsDialogIndId,
  isCatalogOpen,
  setIsCatalogOpen,
  handleToggleVisibility,
  handleRemoveIndicator,
  handleAddIndicator,
  handleSaveSettings,
}) {
  return (
    <>
      {/* Active Indicators Stack (Top-left below toolbar) */}
      <ActiveIndicatorStack
        activeIndicators={activeIndicators}
        onToggleVisibility={handleToggleVisibility}
        onOpenSettings={(id) => setSettingsDialogIndId(id)}
        onRemoveIndicator={handleRemoveIndicator}
        onOpenCatalog={() => setIsCatalogOpen(true)}
      />

      {/* Indicators Catalog Modal */}
      <IndicatorsModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        activeIndicators={activeIndicators}
        onAddIndicator={handleAddIndicator}
        onRemoveIndicator={handleRemoveIndicator}
        onOpenSettings={(id) => setSettingsDialogIndId(id)}
      />

      {/* Indicator Settings Dialog */}
      <IndicatorSettingsDialog
        isOpen={Boolean(settingsDialogIndId)}
        indicatorId={settingsDialogIndId}
        currentInputs={activeIndicators.find((i) => i.id === settingsDialogIndId)?.inputs}
        currentStyles={activeIndicators.find((i) => i.id === settingsDialogIndId)?.styles}
        onClose={() => setSettingsDialogIndId(null)}
        onSave={handleSaveSettings}
      />
    </>
  );
}
