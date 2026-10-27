import React from 'react';
import IndicatorsModal from '../indicators/IndicatorsModal';
import IndicatorSettingsDialog from '../indicators/IndicatorSettingsDialog';

// Док индикаторов панели: каталог + диалог настроек.
// Активные пилюли индикаторов отображаются в ChartLegend (TradingView-style).

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
        onSave={(inputs, styles) => {
          handleSaveSettings(settingsDialogIndId, inputs, styles);
          setSettingsDialogIndId(null);
        }}
      />
    </>
  );
}
