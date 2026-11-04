# Diagnostik Wed Nov  4 09:51:57 UTC 2026
## WMS avoin
- Ahti_Limit_L
- Berths_L
- Dam_A
- Dam_L
- ExclusiveEconomicZone_A
- ExclusiveEconomicZone_L
- Gate_L
- PilotBoardingPlace_P
- Pontoon_A
- Pontoon_L
- Rdocal_L
- Rdocal_P
- ShorelineConstruction_L
- ShorelineConstruction_P
- StraightTerritorialSeaBaseline_L
- TerritorialSeaArea_A
- TerritorialSeaArea_L
- VTSArea_A
- VTS_AREA_A
- WMS
- aluemeri_raja_a
- aluemeri_raja_v
- d_alueet
- default-style-navigational_warnings
- generic
- kohtaamis_ja_ohittamiskieltoalueet
- line
- navigational_warnings
- point
- polygon
- polygon_raja
- rantarakenteet
- sisavesi_raja_v
- sisavesien_vertaustasot
- sulut_a
- sulut_v
- talousvyohyke_a
- talousvyohyke_v
- tuotejako
- tuotejako_enc_approach
- tuotejako_enc_berthing
- tuotejako_enc_coastal
- tuotejako_enc_general
- tuotejako_enc_harbour
- tuotejako_kaikki
- tuotejako_merikarttasarjat
- tuotejako_rannikkokartat
- tuotejako_satamakartat
- tuotejako_sisavesikartat
- tuotejako_veneilykartat
- tuotejako_yleiskartat
- valtakunnan_raja_a
- valtakunnan_raja_v
## WMS rajoitettu
- DeepWaterRoutePart_A
- DepthArea_A
- DepthContour_L
- DredgedArea_A
- PrecautionaryArea_A
- Sounding_P
- Syvyyspiste_point
- TrafficSeaparationLine_L
- TrafficSeaparationZone_A
- TrafficSeparationLine_L
- TrafficSeparationSchemeBoundary_L
- TrafficSeparationSchemeLanePart_A
- TrafficSeparationZone_A
- TwoWayRoutePart_A
- UnsurveyedArea_A
- WMS
- line
- polygon_raja
- rantarakenteet
- reittijakojarjestelma_a
- syvyysalue_a
- syvyyskayra
## CORS kartbild
    HTTP/1.1 200 
    content-type: image/png
    access-control-allow-origin: *
    x-content-type-options: nosniff
## Syvyysmalli / bathymetri (sök i avoin + andra tjänster)
- https://julkinen.traficom.fi/inspirepalvelu/syvyysmalli/wfs?service=WFS&request=GetCapabilities → 401, 
- https://julkinen.traficom.fi/syvyysmalli/wfs?service=WFS&request=GetCapabilities → 500, 
- https://julkinen.traficom.fi/inspirepalvelu/wcs?service=WCS&request=GetCapabilities → 500, 
