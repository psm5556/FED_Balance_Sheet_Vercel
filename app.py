import streamlit as st
import pandas as pd
import requests
from datetime import datetime, timedelta
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# 페이지 설정
st.set_page_config(
    page_title="Fed 모니터링 대시보드",
    page_icon="📊",
    layout="wide"
)

# CSS 스타일링
st.markdown("""
<style>
    .dataframe {
        font-size: 16px;
        width: 100%;
    }
    .dataframe th {
        background-color: #2d2d2d;
        color: #ffffff;
        font-weight: bold;
        text-align: left;
        padding: 12px;
    }
    .dataframe td {
        padding: 12px;
        color: #ffffff;
        background-color: #1e1e1e;
    }
    .positive {
        color: #4ade80;
    }
    .negative {
        color: #f87171;
    }
    a {
        color: #64b5f6;
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
    div[data-testid="stDataFrame"] {
        background-color: #0e1117;
    }
</style>
""", unsafe_allow_html=True)

# FRED API 키
try:
    FRED_API_KEY = st.secrets.get("FRED_API_KEY", "")
except:
    FRED_API_KEY = ""

# TabPFN API 토큰
try:
    TABPFN_TOKEN = st.secrets.get("TABPFN_API_TOKEN", "")
except:
    TABPFN_TOKEN = ""

# ==================== 공통 함수 ====================

@st.cache_data(ttl=1800)
def fetch_fred_data(series_id, api_key, limit=10, start_date=None, end_date=None):
    """FRED API에서 데이터 가져오기"""
    if not api_key:
        return None
    
    url = f"https://api.stlouisfed.org/fred/series/observations"
    
    if start_date and end_date:
        params = {
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "observation_start": start_date,
            "observation_end": end_date,
            "sort_order": "desc"
        }
    else:
        default_end = datetime.now().strftime('%Y-%m-%d')
        default_start = (datetime.now() - timedelta(days=1825)).strftime('%Y-%m-%d')
        params = {
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": limit,
            "observation_start": default_start,
            "observation_end": default_end
        }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if "observations" in data and len(data["observations"]) > 0:
                df = pd.DataFrame(data["observations"])
                if "date" not in df.columns:
                    return None
                try:
                    df["date"] = pd.to_datetime(df["date"])
                except:
                    return None
                if "value" not in df.columns:
                    return None
                df["value"] = pd.to_numeric(df["value"], errors="coerce")
                df = df.dropna(subset=['value'])
                if len(df) == 0:
                    return None
                df = df[['date', 'value']].sort_values('date', ascending=False)
                return df
    except:
        return None
    return None

# ==================== Fear & Greed 히스토리 함수 ====================

def _parse_cnn_component(data, key, y_col):
    """CNN JSON에서 컴포넌트 데이터 파싱 헬퍼"""
    if key in data and 'data' in data[key]:
        df = pd.DataFrame(data[key]['data'])
        df['date'] = pd.to_datetime(df['x'], unit='ms')
        df = df.rename(columns={'y': y_col})[['date', y_col]].sort_values('date')
        return df
    return None

def _score_to_rating(s):
    """점수 → rating 문자열 변환"""
    if s < 25:   return 'extreme fear'
    if s < 45:   return 'fear'
    if s < 55:   return 'neutral'
    if s < 75:   return 'greed'
    return 'extreme greed'

@st.cache_data(ttl=1800)
def fetch_fear_greed_full_history():
    """
    CNN Fear & Greed 최대 10년+ 히스토리 데이터 가져오기
    
    전략:
    ① 구형 데이터(2011~2020): Part-Time Larry GitHub CSV
       https://raw.githubusercontent.com/hackingthemarkets/
       sentiment-fear-and-greed/master/datasets/fear-greed.csv
    ② 신형 데이터(2020~현재): CNN API + 시작일 파라미터
       https://production.dataviz.cnn.io/index/fearandgreed/graphdata/YYYY-MM-DD
    ③ 두 데이터를 merge → 중복 제거 → 최대 10년치 반환
    """
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    result = {}

    # ─────────────────────────────────────────
    # ① 구형 데이터: GitHub CSV (2011 ~ ~2020-09)
    # ─────────────────────────────────────────
    df_old = None
    OLD_CSV_URL = (
        'https://raw.githubusercontent.com/hackingthemarkets/'
        'sentiment-fear-and-greed/master/datasets/fear-greed.csv'
    )
    try:
        from io import StringIO
        r_old = requests.get(OLD_CSV_URL, headers=headers, timeout=15)
        if r_old.status_code == 200:
            df_old = pd.read_csv(StringIO(r_old.text))
            # 컬럼: Date, Fear Greed
            df_old['date']   = pd.to_datetime(df_old['Date'])
            df_old['score']  = pd.to_numeric(df_old['Fear Greed'], errors='coerce')
            df_old = df_old.dropna(subset=['score'])
            df_old['rating'] = df_old['score'].apply(_score_to_rating)
            df_old = df_old[['date', 'score', 'rating']].sort_values('date')
    except Exception:
        df_old = None  # CSV 실패 시 CNN만으로 진행

    # ─────────────────────────────────────────
    # ② 신형 데이터: CNN API + start_date 파라미터
    #    - df_old 가 있으면 마지막 날 다음부터 요청
    #    - 없으면 10년 전부터 요청
    # ─────────────────────────────────────────
    if df_old is not None and len(df_old) > 0:
        cnn_start = (df_old['date'].max() + timedelta(days=1)).strftime('%Y-%m-%d')
    else:
        cnn_start = (datetime.now() - timedelta(days=365 * 10)).strftime('%Y-%m-%d')

    # 먼저 시작일 지정 URL 시도, 실패 시 날짜 없는 기본 URL fallback
    cnn_urls = [
        f"https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{cnn_start}",
        "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
    ]

    cnn_data = None
    for cnn_url in cnn_urls:
        try:
            r = requests.get(cnn_url, headers=headers, timeout=15)
            if r.status_code == 200:
                cnn_data = r.json()
                break
        except Exception:
            continue

    if cnn_data is None:
        # CNN 완전 실패 시 구형 데이터만으로 반환
        if df_old is not None and len(df_old) > 0:
            result['fg_history'] = df_old
        return result if result else None

    # 현재 F&G 값
    if 'fear_and_greed' in cnn_data:
        result['current'] = cnn_data['fear_and_greed']

    # CNN F&G 히스토리 파싱
    df_new = None
    if 'fear_and_greed_historical' in cnn_data and 'data' in cnn_data['fear_and_greed_historical']:
        raw = cnn_data['fear_and_greed_historical']['data']
        df_new = pd.DataFrame(raw)
        df_new['date']   = pd.to_datetime(df_new['x'], unit='ms')
        df_new['score']  = pd.to_numeric(df_new['y'], errors='coerce')
        df_new['rating'] = df_new.get('rating', df_new['score'].apply(_score_to_rating))
        df_new = df_new[['date', 'score', 'rating']].dropna(subset=['score']).sort_values('date')

    # ─────────────────────────────────────────
    # ③ 병합 (구형 + 신형) → 중복 제거
    # ─────────────────────────────────────────
    if df_old is not None and df_new is not None:
        df_fg = pd.concat([df_old, df_new], ignore_index=True)
        df_fg = df_fg.drop_duplicates(subset='date', keep='last')
        df_fg = df_fg.sort_values('date').reset_index(drop=True)
    elif df_new is not None:
        df_fg = df_new
    elif df_old is not None:
        df_fg = df_old
    else:
        return None

    result['fg_history'] = df_fg

    # 데이터 커버리지 로그 (사이드바에 표시용)
    result['data_source_info'] = {
        'total_days': len(df_fg),
        'start_date': df_fg['date'].min().strftime('%Y-%m-%d'),
        'end_date':   df_fg['date'].max().strftime('%Y-%m-%d'),
        'has_old_csv': df_old is not None,
    }

    # 서브 컴포넌트 (CNN에서만 제공; 시작일 지정 시 더 긴 기간 포함 가능)
    result['sp500']     = _parse_cnn_component(cnn_data, 'market_momentum_sp500',  'price')
    result['vix']       = _parse_cnn_component(cnn_data, 'market_volatility_vix',  'vix')
    result['put_call']  = _parse_cnn_component(cnn_data, 'put_call_options',        'ratio')
    result['junk_bond'] = _parse_cnn_component(cnn_data, 'junk_bond_demand',        'spread')

    return result

# ==================== TabPFN-TS 예측 함수 ====================

# ── tabpfn_client 토큰 파일 경로 자동 설정 ────────────────────────────────
# tabpfn_client 는 토큰을 site-packages 안에 저장하려 함 (읽기 전용일 수 있음)
# → 쓰기 가능한 경로를 탐색해 UserAuthenticationClient.CACHED_TOKEN_FILE 패치
#
# 우선순위:
#   1. ~/.tabpfn/config         ← 로컬 PC: 홈 디렉토리 (재시작 후에도 유지)
#   2. /tmp/tabpfn_auth/config  ← Streamlit Cloud: 임시 디렉토리
#   3. 기본값 그대로             ← 이미 쓰기 가능한 경우
# ─────────────────────────────────────────────────────────────────────────────

def _patch_tabpfn_token_path():
    """
    tabpfn_client 토큰 저장 경로를 쓰기 가능한 위치로 자동 설정.
    로컬 PC: ~/.tabpfn/config (홈 디렉토리, 영구 보존)
    Streamlit Cloud: /tmp/tabpfn_auth/config (임시, 매 재시작 초기화)
    """
    import pathlib, os

    # ① 쓰기 가능 경로 후보 (우선순위 순)
    candidates = [
        pathlib.Path.home() / ".tabpfn",          # 로컬 PC
        pathlib.Path("/tmp") / "tabpfn_auth",      # Streamlit Cloud
        pathlib.Path(os.getcwd()) / ".tabpfn",     # 현재 디렉토리 fallback
    ]

    chosen_dir = None
    for d in candidates:
        try:
            d.mkdir(parents=True, exist_ok=True)
            probe = d / "_write_probe"
            probe.write_text("ok")
            probe.unlink()
            chosen_dir = d
            break
        except Exception:
            continue

    if chosen_dir is None:
        # 모두 실패하면 기본 경로 그대로 (로컬 일반 설치에서는 동작)
        return None

    token_file = chosen_dir / "config"

    # ② UserAuthenticationClient.CACHED_TOKEN_FILE 직접 패치
    try:
        from tabpfn_client.service_wrapper import UserAuthenticationClient
        import tabpfn_client.service_wrapper as sw
        UserAuthenticationClient.CACHED_TOKEN_FILE = token_file
        sw.CACHE_DIR = chosen_dir
    except Exception:
        pass

    # ③ constants.CACHE_DIR 패치
    try:
        import tabpfn_client.constants as const
        const.CACHE_DIR = chosen_dir
    except Exception:
        pass

    return token_file


@st.cache_resource
def _init_tabpfn_client(token: str):
    """tabpfn-client 초기화 (앱 세션당 1회) — 환경에 맞는 토큰 경로 자동 설정"""
    try:
        import tabpfn_client
        if token:
            _patch_tabpfn_token_path()
            tabpfn_client.set_access_token(token)
        return True, None
    except ImportError:
        return False, "tabpfn-client 미설치"
    except Exception as e:
        return False, str(e)


@st.cache_data(ttl=3600, show_spinner=False)
def _get_tabpfn_ts_version() -> tuple:
    """tabpfn-time-series 설치 버전 반환 (major, minor, patch)"""
    try:
        import importlib.metadata
        ver = importlib.metadata.version("tabpfn-time-series")
        parts = [int(x) for x in ver.split(".")[:3]]
        while len(parts) < 3:
            parts.append(0)
        return tuple(parts), ver
    except Exception:
        return (0, 0, 0), "unknown"


def _clean_timeseries_for_tabpfn(values, timestamps):
    """
    TabPFN-TS 입력 전처리:
    - 날짜+값 쌍으로 정렬
    - 중복 날짜 제거 (최신값 유지)
    - NaN / None 값 선형보간 + ffill/bfill
    - 일별 리샘플링 → AutoSeasonalFeature FFT 오류 방지
    Returns cleaned (values_list, timestamps_list)
    """
    dates = pd.to_datetime(list(timestamps))
    vals  = pd.to_numeric(list(values), errors='coerce')

    s = pd.Series(vals, index=dates, name="target")
    s = s.sort_index()
    # 중복 인덱스 제거
    s = s[~s.index.duplicated(keep='last')]
    # NaN 보간 (선형 → ffill → bfill 순서)
    s = s.interpolate(method='time').ffill().bfill()
    # 일별(B=영업일) 리샘플링으로 규칙적 주기 확보
    s = s.resample('D').last().ffill()
    s = s.dropna()

    return s.tolist(), s.index.strftime('%Y-%m-%d').tolist()


def _run_tabpfn_v1(values, timestamps, pred_len, item_id, token):
    """tabpfn-time-series >= 1.0.0 API"""
    import tabpfn_client
    from tabpfn_time_series import (
        TimeSeriesDataFrame,
        FeatureTransformer,
        TabPFNTimeSeriesPredictor,
        TabPFNMode,
    )
    from tabpfn_time_series.data_preparation import generate_test_X
    from tabpfn_time_series.features import RunningIndexFeature, CalendarFeature

    if token:
        _patch_tabpfn_token_path()
        tabpfn_client.set_access_token(token)

    # ── 전처리: 일별 규칙 시계열로 정규화 ──────────────────────────────────
    clean_vals, clean_dates = _clean_timeseries_for_tabpfn(values, timestamps)
    if len(clean_vals) < pred_len + 10:
        raise ValueError(
            f"전처리 후 데이터가 너무 적습니다 ({len(clean_vals)}행). "
            "학습 기간을 늘리거나 다른 데이터를 선택하세요."
        )
    clean_ts = pd.to_datetime(clean_dates)

    # ── TimeSeriesDataFrame 구성 ─────────────────────────────────────────────
    df = pd.DataFrame(
        {"target": clean_vals},
        index=pd.MultiIndex.from_arrays(
            [[item_id] * len(clean_ts), clean_ts],
            names=["item_id", "timestamp"],
        ),
    )
    full_tsdf = TimeSeriesDataFrame(df)

    # 미래 예측용: 전체 데이터를 학습 → 마지막 날짜 이후 pred_len 일 생성
    train = full_tsdf
    test  = generate_test_X(train, pred_len)

    # 과거 검증용(backtesting): 마지막 pred_len 행을 제외하고 학습 → 그 기간 예측
    # train_test_split 은 v1.0.9 에 없으므로 직접 슬라이싱 후 generate_test_X 로 test 생성
    try:
        if len(clean_vals) > pred_len:
            bt_vals  = clean_vals[:-pred_len]
            bt_dates = clean_ts[:-pred_len]
            df_bt = pd.DataFrame(
                {"target": bt_vals},
                index=pd.MultiIndex.from_arrays(
                    [[item_id] * len(bt_dates), bt_dates],
                    names=["item_id", "timestamp"],
                ),
            )
            train_bt = TimeSeriesDataFrame(df_bt)
            test_bt  = generate_test_X(train_bt, pred_len)
        else:
            train_bt, test_bt = None, None
    except Exception:
        train_bt, test_bt = None, None

    # ── 피처 공학 ──────────────────────────────────────────────────────────
    features = [RunningIndexFeature(), CalendarFeature()]

    try:
        from tabpfn_time_series.features import AutoSeasonalFeature
        asf = AutoSeasonalFeature()
        _tmp_train = train.copy()
        _tmp_test  = test.copy()
        _, _ = FeatureTransformer([asf]).transform(_tmp_train, _tmp_test)
        features.append(AutoSeasonalFeature())
    except Exception:
        pass

    train, test = FeatureTransformer(features).transform(train, test)

    # 과거 검증용 피처 변환
    if train_bt is not None:
        try:
            train_bt, test_bt = FeatureTransformer(features).transform(train_bt, test_bt)
        except Exception:
            train_bt, test_bt = None, None

    # ── 예측 ───────────────────────────────────────────────────────────────
    predictor = TabPFNTimeSeriesPredictor(tabpfn_mode=TabPFNMode.CLIENT)
    pred = predictor.predict(train, test)

    # ── 결과 정리 (미래 예측) ──────────────────────────────────────────────
    pred_df = pred.reset_index()
    ts_candidates = [c for c in pred_df.columns
                     if "time" in str(c).lower() and c != "item_id"]
    if ts_candidates and "timestamp" not in pred_df.columns:
        pred_df = pred_df.rename(columns={ts_candidates[0]: "timestamp"})
    pred_df["timestamp"] = pd.to_datetime(pred_df["timestamp"])

    # ── 결과 정리 (과거 검증 예측) ────────────────────────────────────────
    hist_pred_df = None
    if train_bt is not None:
        try:
            bt_pred = predictor.predict(train_bt, test_bt)
            hist_pred_df = bt_pred.reset_index()
            ts_cands_bt = [c for c in hist_pred_df.columns
                           if "time" in str(c).lower() and c != "item_id"]
            if ts_cands_bt and "timestamp" not in hist_pred_df.columns:
                hist_pred_df = hist_pred_df.rename(columns={ts_cands_bt[0]: "timestamp"})
            hist_pred_df["timestamp"] = pd.to_datetime(hist_pred_df["timestamp"])
        except Exception:
            hist_pred_df = None

    return pred_df, hist_pred_df


def _run_tabpfn_v0(values, timestamps, pred_len, token):
    """tabpfn-time-series 0.x (구버전) API — TabPFNTimeSeriesPredictor만 존재"""
    from tabpfn_time_series import TabPFNTimeSeriesPredictor

    # v0.x는 DatetimeIndex Series를 직접 입력으로 받음
    train_series = pd.Series(
        values[:-pred_len] if len(values) > pred_len else values,
        index=pd.DatetimeIndex(timestamps[:-pred_len] if len(timestamps) > pred_len else timestamps),
    )

    predictor = TabPFNTimeSeriesPredictor()

    # fit_predict 또는 predict 메서드 탐색 (버전에 따라 다름)
    if hasattr(predictor, "fit_predict"):
        preds = predictor.fit_predict(train_series, prediction_length=pred_len)
    elif hasattr(predictor, "fit") and hasattr(predictor, "predict"):
        predictor.fit(train_series)
        preds = predictor.predict(prediction_length=pred_len)
    else:
        raise RuntimeError("v0.x TabPFNTimeSeriesPredictor에서 예측 메서드를 찾을 수 없습니다.")

    # 결과를 표준 형식으로 변환
    if isinstance(preds, pd.Series):
        pred_df = preds.reset_index()
        pred_df.columns = ["timestamp", "target"]
    elif isinstance(preds, pd.DataFrame):
        pred_df = preds.reset_index() if preds.index.name else preds.copy()
        if "timestamp" not in pred_df.columns:
            pred_df = pred_df.rename(columns={pred_df.columns[0]: "timestamp"})
        if "target" not in pred_df.columns and len(pred_df.columns) >= 2:
            pred_df = pred_df.rename(columns={pred_df.columns[1]: "target"})
    else:
        raise RuntimeError(f"예상치 못한 예측 결과 타입: {type(preds)}")

    pred_df["timestamp"] = pd.to_datetime(pred_df["timestamp"])
    return pred_df


def run_tabpfn_forecast(
    values_tuple: tuple,
    dates_tuple: tuple,
    pred_len: int,
    item_id: str,
    token: str,
) -> tuple:
    """
    TabPFN-TS 시계열 예측 실행.
    v1.x(CLIENT 모드, 신뢰구간 포함)와 v0.x(기본 포인트 예측) 모두 지원.

    Returns
    -------
    (pred_df, hist_pred_df, error_msg) — 성공 시 error_msg=None
    pred_df      : 미래 예측 (timestamp, target [, 0.1, 0.25, 0.5, 0.75, 0.9])
    hist_pred_df : 과거 검증 예측 — 마지막 pred_len 기간을 모델로 재예측한 결과 (None 가능)
    """
    # ── 버전 확인 ──
    (major, minor, _), ver_str = _get_tabpfn_ts_version()

    if major == 0 and minor == 0:
        return None, None, (
            "❌ tabpfn-time-series 패키지를 찾을 수 없습니다.\n"
            "requirements.txt에 아래 내용을 추가하고 재배포하세요:\n"
            "```\ntabpfn-time-series>=1.0.0\n```"
        )

    timestamps = pd.to_datetime(list(dates_tuple))
    values     = list(values_tuple)

    # ── v1.x 경로 ──
    if major >= 1:
        try:
            pred_df, hist_pred_df = _run_tabpfn_v1(values, timestamps, pred_len, item_id, token)
            return pred_df, hist_pred_df, None
        except ImportError as e:
            return None, None, (
                f"❌ tabpfn-time-series {ver_str} 에서 필요한 모듈을 찾을 수 없습니다.\n"
                f"오류 상세: {e}\n\n"
                f"requirements.txt를 아래와 같이 업데이트하세요:\n"
                f"```\ntabpfn-time-series>=1.0.0\n```"
            )
        except Exception as e:
            return None, None, f"❌ 예측 실패 (v{ver_str}): {str(e)}"

    # ── v0.x 경로 (구버전 fallback) ──
    try:
        pred_df = _run_tabpfn_v0(values, timestamps, pred_len, token)
        return pred_df, None, None
    except ImportError as e:
        return None, None, (
            f"❌ tabpfn-time-series {ver_str} (구버전) — 임포트 실패\n"
            f"오류: {e}\n\n"
            "신뢰구간 예측을 위해 1.x 버전으로 업그레이드를 권장합니다:\n"
            "```\ntabpfn-time-series>=1.0.0\n```"
        )
    except Exception as e:
        return None, None, (
            f"❌ 예측 실패 (tabpfn-time-series {ver_str} 구버전)\n"
            f"오류: {str(e)}\n\n"
            "💡 v1.x로 업그레이드하면 신뢰구간 예측 및 더 나은 정확도를 사용할 수 있습니다:\n"
            "requirements.txt → `tabpfn-time-series>=1.0.0`"
        )


def create_forecast_chart(
    df_hist: pd.DataFrame,
    hist_col: str,
    pred_df: pd.DataFrame,
    title: str,
    y_label: str,
    is_fg: bool = False,
    y_min: float = None,
    y_max: float = None,
    hist_pred_df: pd.DataFrame = None,
):
    """
    히스토리(마지막 90일) + TabPFN-TS 예측 + 신뢰구간 통합 차트.

    Parameters
    ----------
    df_hist      : 히스토리 DataFrame — 'date' + hist_col
    hist_col     : 히스토리 값 컬럼명 (예: 'score', 'price')
    pred_df      : 미래 예측 결과 DataFrame — 'timestamp', 'target', '0.1', '0.9', …
    is_fg        : True이면 Fear & Greed 배경 구간 표시
    hist_pred_df : 과거 검증 예측 DataFrame — pred_df 와 동일한 컬럼 구조 (None 가능)
    """
    if df_hist is None or pred_df is None or len(pred_df) == 0:
        return None

    # timestamp → date
    pred_df = pred_df.copy()
    pred_df["date"] = pd.to_datetime(pred_df.get("timestamp", pred_df.index))

    # point forecast 컬럼
    point_col = "target" if "target" in pred_df.columns else pred_df.columns[2]

    # quantile 컬럼 탐색 (문자열/숫자 모두 고려)
    def _find_col(df, *candidates):
        for c in candidates:
            if c in df.columns:
                return c
        return None

    q10 = _find_col(pred_df, "0.1", 0.1)
    q25 = _find_col(pred_df, "0.25", 0.25)
    q75 = _find_col(pred_df, "0.75", 0.75)
    q90 = _find_col(pred_df, "0.9", 0.9)

    fig = go.Figure()

    # F&G 배경 구간
    if is_fg:
        zones = [
            (0, 25,  "rgba(220,38,38,0.07)",  "Extreme Fear"),
            (25, 45, "rgba(249,115,22,0.07)",  "Fear"),
            (45, 55, "rgba(234,179,8,0.07)",   "Neutral"),
            (55, 75, "rgba(34,197,94,0.07)",   "Greed"),
            (75, 100,"rgba(22,163,74,0.07)",   "Extreme Greed"),
        ]
        for y0, y1, color, lbl in zones:
            fig.add_hrect(y0=y0, y1=y1, fillcolor=color, line_width=0,
                          annotation_text=lbl, annotation_position="left",
                          annotation_font_size=9,
                          annotation_font_color="rgba(200,200,200,0.4)")

    # ── 히스토리: 최근 120일만 표시 (미래 예측과 연결이 잘 보이도록) ────────
    last_date   = df_hist["date"].max()
    first_date  = pred_df["date"].min()   # 예측 시작일 (미래)

    # 예측이 실제로 미래에 있는지 확인
    is_future   = first_date > last_date

    # 히스토리는 최근 120일
    df_tail = df_hist[["date", hist_col]].dropna().tail(120).copy()

    fig.add_trace(go.Scatter(
        x=df_tail["date"], y=df_tail[hist_col],
        mode="lines", name="실제 데이터",
        line=dict(color="#60a5fa", width=2),
        hovertemplate="<b>%{x|%Y-%m-%d}</b><br>실제: <b>%{y:.2f}</b><extra></extra>",
    ))

    # 히스토리 마지막 점 → 예측 첫 점 연결선 (시각적 연속성)
    if is_future and len(df_tail) > 0:
        connect_x = [df_tail["date"].iloc[-1], pred_df["date"].iloc[0]]
        connect_y = [df_tail[hist_col].iloc[-1], pred_df[point_col].iloc[0]]
        fig.add_trace(go.Scatter(
            x=connect_x, y=connect_y,
            mode="lines", name="_연결선",
            line=dict(color="#fbbf24", width=1.5, dash="dot"),
            showlegend=False,
            hoverinfo="skip",
        ))

    # ── 과거 검증(backtest) 예측 라인 ────────────────────────────────────────
    if hist_pred_df is not None and len(hist_pred_df) > 0:
        hpdf = hist_pred_df.copy()
        hpdf["date"] = pd.to_datetime(hpdf.get("timestamp", hpdf.index))
        hp_point = "target" if "target" in hpdf.columns else hpdf.columns[2]

        hp_q10 = _find_col(hpdf, "0.1", 0.1)
        hp_q90 = _find_col(hpdf, "0.9", 0.9)
        hp_q25 = _find_col(hpdf, "0.25", 0.25)
        hp_q75 = _find_col(hpdf, "0.75", 0.75)

        # 과거 검증 신뢰구간 80%
        if hp_q10 is not None and hp_q90 is not None:
            hx = pd.concat([hpdf["date"], hpdf["date"].iloc[::-1].reset_index(drop=True)])
            hy = pd.concat([hpdf[hp_q90], hpdf[hp_q10].iloc[::-1].reset_index(drop=True)])
            fig.add_trace(go.Scatter(
                x=hx, y=hy,
                fill="toself", fillcolor="rgba(52,211,153,0.10)",
                line=dict(color="rgba(0,0,0,0)"),
                name="과거검증 신뢰구간 80%",
                hoverinfo="skip",
            ))

        # 과거 검증 신뢰구간 50%
        if hp_q25 is not None and hp_q75 is not None:
            hx2 = pd.concat([hpdf["date"], hpdf["date"].iloc[::-1].reset_index(drop=True)])
            hy2 = pd.concat([hpdf[hp_q75], hpdf[hp_q25].iloc[::-1].reset_index(drop=True)])
            fig.add_trace(go.Scatter(
                x=hx2, y=hy2,
                fill="toself", fillcolor="rgba(52,211,153,0.20)",
                line=dict(color="rgba(0,0,0,0)"),
                name="과거검증 신뢰구간 50%",
                hoverinfo="skip",
            ))

        # 과거 검증 포인트 라인
        fig.add_trace(go.Scatter(
            x=hpdf["date"], y=hpdf[hp_point],
            mode="lines+markers",
            name="과거 검증 예측 (TabPFN-TS)",
            line=dict(color="#34d399", width=2, dash="dash"),
            marker=dict(size=5, color="#34d399", line=dict(color="white", width=1)),
            hovertemplate="<b>%{x|%Y-%m-%d}</b><br>검증 예측: <b>%{y:.2f}</b><extra></extra>",
        ))

    # 신뢰구간 10%~90% (연한 밴드)
    if q10 is not None and q90 is not None:
        x_fill = pd.concat([pred_df["date"], pred_df["date"].iloc[::-1].reset_index(drop=True)])
        y_fill = pd.concat([pred_df[q90], pred_df[q10].iloc[::-1].reset_index(drop=True)])
        fig.add_trace(go.Scatter(
            x=x_fill, y=y_fill,
            fill="toself", fillcolor="rgba(251,191,36,0.13)",
            line=dict(color="rgba(0,0,0,0)"),
            name="신뢰구간 80% (10~90%)",
            hoverinfo="skip",
        ))

    # 신뢰구간 25%~75% (진한 밴드)
    if q25 is not None and q75 is not None:
        x_fill2 = pd.concat([pred_df["date"], pred_df["date"].iloc[::-1].reset_index(drop=True)])
        y_fill2 = pd.concat([pred_df[q75], pred_df[q25].iloc[::-1].reset_index(drop=True)])
        fig.add_trace(go.Scatter(
            x=x_fill2, y=y_fill2,
            fill="toself", fillcolor="rgba(251,191,36,0.25)",
            line=dict(color="rgba(0,0,0,0)"),
            name="신뢰구간 50% (25~75%)",
            hoverinfo="skip",
        ))

    # 미래 예측 포인트 라인
    fig.add_trace(go.Scatter(
        x=pred_df["date"], y=pred_df[point_col],
        mode="lines+markers",
        name=f"{'미래 예측 ' if is_future else ''}TabPFN-TS",
        line=dict(color="#fbbf24", width=2.5, dash="dash" if not is_future else "solid"),
        marker=dict(size=6, color="#fbbf24",
                    line=dict(color="white", width=1)),
        hovertemplate="<b>%{x|%Y-%m-%d}</b><br>예측: <b>%{y:.2f}</b><extra></extra>",
    ))

    # 오늘(마지막 실제 데이터) 기준 수직선 — 과거/미래 구분선
    today_label = last_date.strftime("%m/%d")
    fig.add_vline(
        x=last_date.timestamp() * 1000,
        line_dash="solid", line_color="rgba(255,255,255,0.5)", line_width=1.5,
        annotation_text=f"  ← 실제  |  예측 →   ({today_label})",
        annotation_position="top",
        annotation_font_color="rgba(220,220,220,0.85)",
        annotation_font_size=11,
    )

    # x축 범위: 히스토리 시작 ~ 예측 마지막 + 여유
    x_start = df_tail["date"].min() if len(df_tail) > 0 else last_date - pd.Timedelta(days=120)
    x_end   = pred_df["date"].max() + pd.Timedelta(days=3)

    fig.update_layout(
        title=dict(
            text=f"{title}  <span style='font-size:12px;color:#fbbf24;'>{'▶ 미래 예측' if is_future else '⚠ 과거 기간 예측'}</span>",
            font=dict(color="white", size=15)
        ),
        xaxis=dict(
            color="white",
            gridcolor="rgba(75,75,75,0.3)",
            range=[x_start, x_end],
        ),
        yaxis=dict(
            title=y_label, color="white",
            gridcolor="rgba(75,75,75,0.3)",
            range=[y_min, y_max] if y_min is not None else None,
        ),
        plot_bgcolor="#0e1117",
        paper_bgcolor="#0e1117",
        font=dict(color="white"),
        hovermode="x unified",
        height=450,
        showlegend=True,
        legend=dict(
            orientation="h", y=1.05, x=1, xanchor="right",
            font=dict(color="white", size=11),
        ),
        margin=dict(l=60, r=40, t=75, b=40),
    )
    return fig


def _build_forecast_summary(pred_df: pd.DataFrame) -> pd.DataFrame:
    """예측 결과를 보기 좋은 요약 테이블로 변환"""
    df = pred_df.copy()
    df["date"] = pd.to_datetime(df.get("timestamp", df.index))
    point_col = "target" if "target" in df.columns else df.columns[2]

    summary = pd.DataFrame({"날짜": df["date"].dt.strftime("%Y-%m-%d"),
                             "예측값": df[point_col].round(2)})
    for label, keys in [
        ("하한 10%", ["0.1", 0.1]),
        ("하한 25%", ["0.25", 0.25]),
        ("중앙값 50%", ["0.5", 0.5]),
        ("상한 75%", ["0.75", 0.75]),
        ("상한 90%", ["0.9", 0.9]),
    ]:
        for k in keys:
            if k in df.columns:
                summary[label] = df[k].round(2)
                break
    return summary


def rating_to_color(rating) -> str:
    """rating 문자열을 색상으로 변환 (None/NaN/float 안전 처리)"""
    if rating is None or not isinstance(rating, str):
        return '#9ca3af'
    mapping = {
        'extreme fear':  '#dc2626',
        'fear':          '#f97316',
        'neutral':       '#eab308',
        'greed':         '#22c55e',
        'extreme greed': '#16a34a',
    }
    return mapping.get(str(rating).lower().strip(), '#9ca3af')

def create_fg_history_chart(df_fg, df_sp500=None):
    """Fear & Greed 히스토리 메인 차트 (색상 구간 + S&P500 이중 y축 오버레이)"""
    if df_fg is None or len(df_fg) == 0:
        return None

    has_sp500 = df_sp500 is not None and len(df_sp500) > 0

    # 이중 y축 단일 차트
    fig = make_subplots(specs=[[{"secondary_y": True}]])

    # 배경 구간 색상 (주축 기준 0~100)
    zones = [
        (0, 25,   'rgba(220,38,38,0.08)',   'Extreme Fear'),
        (25, 45,  'rgba(249,115,22,0.08)',  'Fear'),
        (45, 55,  'rgba(234,179,8,0.08)',   'Neutral'),
        (55, 75,  'rgba(34,197,94,0.08)',   'Greed'),
        (75, 100, 'rgba(22,163,74,0.08)',   'Extreme Greed'),
    ]
    for y0, y1, color, label in zones:
        fig.add_hrect(
            y0=y0, y1=y1,
            fillcolor=color,
            line_width=0,
            annotation_text=label,
            annotation_position="left",
            annotation_font_size=10,
            annotation_font_color='rgba(200,200,200,0.5)',
        )

    # 기준선
    for lvl in [25, 45, 55, 75]:
        fig.add_hline(
            y=lvl, line_dash="dot", line_color="rgba(150,150,150,0.3)",
            line_width=1,
        )

    # S&P 500 — 보조 y축 (먼저 추가해 레이어 순서상 뒤에 위치)
    if has_sp500:
        fig.add_trace(
            go.Scatter(
                x=df_sp500['date'],
                y=df_sp500['price'],
                mode='lines',
                name='S&P 500',
                line=dict(color='#f59e0b', width=1.5),
                opacity=0.85,
                hovertemplate='<b>%{x|%Y-%m-%d}</b><br>S&P 500: <b>%{y:,.0f}</b><extra></extra>'
            ),
            secondary_y=True,
        )

    # Fear & Greed 라인 — 주 y축
    fig.add_trace(
        go.Scatter(
            x=df_fg['date'],
            y=df_fg['score'],
            mode='lines',
            name='Fear & Greed Index',
            line=dict(color='#60a5fa', width=2),
            fill='tozeroy',
            fillcolor='rgba(96,165,250,0.07)',
            hovertemplate=(
                '<b>%{x|%Y-%m-%d}</b><br>'
                'Score: <b>%{y:.1f}</b><br>'
                '<extra></extra>'
            )
        ),
        secondary_y=False,
    )

    # 최신값 마커 — 주 y축
    latest = df_fg.iloc[-1]
    fig.add_trace(
        go.Scatter(
            x=[latest['date']],
            y=[latest['score']],
            mode='markers+text',
            name=f"현재: {latest['score']:.1f}",
            marker=dict(
                size=12,
                color=rating_to_color(latest['rating']),
                symbol='circle',
                line=dict(color='white', width=2)
            ),
            text=[f"  {latest['score']:.1f}"],
            textposition='middle right',
            textfont=dict(color='white', size=12),
            hovertemplate='현재값: %{y:.1f}<extra></extra>'
        ),
        secondary_y=False,
    )

    # y축 설정
    fig.update_yaxes(
        title_text="Fear & Greed Index",
        range=[0, 100],
        gridcolor='rgba(75,75,75,0.3)',
        color='#60a5fa',
        secondary_y=False,
    )
    if has_sp500:
        fig.update_yaxes(
            title_text="S&P 500",
            gridcolor='rgba(0,0,0,0)',  # 보조축 그리드 숨김 (주축과 중복 방지)
            color='#f59e0b',
            secondary_y=True,
        )

    fig.update_xaxes(
        gridcolor='rgba(75,75,75,0.3)',
        color='white',
    )

    fig.update_layout(
        plot_bgcolor='#0e1117',
        paper_bgcolor='#0e1117',
        font=dict(color='white'),
        hovermode='x unified',
        height=450,
        showlegend=True,
        legend=dict(
            orientation='h',
            yanchor='bottom', y=1.01,
            xanchor='right', x=1,
            font=dict(color='white')
        ),
        margin=dict(l=70, r=70, t=60, b=40)
    )

    return fig


def create_fg_sub_indicators_chart(history_data):
    """F&G 세부 구성 지표 차트 (VIX, Put/Call, Junk Bond)"""
    df_vix = history_data.get('vix')
    df_pc = history_data.get('put_call')
    df_jb = history_data.get('junk_bond')

    available = [(df_vix, 'VIX 변동성 지수', '#ef4444'),
                 (df_pc, 'Put/Call Ratio', '#a78bfa'),
                 (df_jb, 'Junk Bond Spread', '#34d399')]
    available = [(df, name, color) for df, name, color in available if df is not None and len(df) > 0]

    if not available:
        return None

    n = len(available)
    fig = make_subplots(
        rows=n, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.06,
        subplot_titles=[name for _, name, _ in available]
    )

    col_map = {'VIX 변동성 지수': 'vix', 'Put/Call Ratio': 'ratio', 'Junk Bond Spread': 'spread'}

    for i, (df, name, color) in enumerate(available, 1):
        ycol = col_map[name]
        fig.add_trace(
            go.Scatter(
                x=df['date'],
                y=df[ycol],
                mode='lines',
                name=name,
                line=dict(color=color, width=1.5),
                hovertemplate=f'<b>%{{x|%Y-%m-%d}}</b><br>{name}: %{{y:.3f}}<extra></extra>'
            ),
            row=i, col=1
        )
        fig.update_yaxes(
            gridcolor='rgba(75,75,75,0.3)',
            color='white',
            row=i, col=1
        )

    fig.update_xaxes(gridcolor='rgba(75,75,75,0.3)', color='white')
    fig.update_layout(
        plot_bgcolor='#0e1117',
        paper_bgcolor='#0e1117',
        font=dict(color='white'),
        hovermode='x unified',
        height=150 * n + 80,
        showlegend=False,
        margin=dict(l=60, r=60, t=40, b=40)
    )
    return fig


def create_fg_distribution_chart(df_fg):
    """Fear & Greed 구간별 비율 파이/바 차트"""
    if df_fg is None or len(df_fg) == 0:
        return None

    rating_order = ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed']
    rating_labels = ['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']
    rating_colors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#16a34a']

    counts = df_fg['rating'].str.lower().value_counts()
    values = [counts.get(r, 0) for r in rating_order]
    total = sum(values)
    pcts = [v / total * 100 if total > 0 else 0 for v in values]

    fig = go.Figure(go.Bar(
        x=rating_labels,
        y=pcts,
        marker_color=rating_colors,
        text=[f'{p:.1f}%' for p in pcts],
        textposition='outside',
        textfont=dict(color='white', size=12),
        hovertemplate='%{x}<br>비율: %{y:.1f}%<br>일수: %{customdata}일<extra></extra>',
        customdata=values
    ))

    fig.update_layout(
        title=dict(text='구간별 출현 비율', font=dict(color='white', size=15)),
        xaxis=dict(color='white', gridcolor='rgba(75,75,75,0.3)'),
        yaxis=dict(title='비율 (%)', color='white', gridcolor='rgba(75,75,75,0.3)'),
        plot_bgcolor='#0e1117',
        paper_bgcolor='#0e1117',
        font=dict(color='white'),
        height=320,
        margin=dict(l=50, r=30, t=50, b=40)
    )
    return fig


def create_fg_rolling_chart(df_fg):
    """Fear & Greed 이동평균 차트"""
    if df_fg is None or len(df_fg) < 10:
        return None

    df = df_fg.copy().sort_values('date')
    df['ma_20'] = df['score'].rolling(20, min_periods=1).mean()
    df['ma_60'] = df['score'].rolling(60, min_periods=1).mean()

    fig = go.Figure()

    fig.add_hrect(y0=0,  y1=25,  fillcolor='rgba(220,38,38,0.06)',  line_width=0)
    fig.add_hrect(y0=25, y1=45,  fillcolor='rgba(249,115,22,0.06)', line_width=0)
    fig.add_hrect(y0=45, y1=55,  fillcolor='rgba(234,179,8,0.06)',  line_width=0)
    fig.add_hrect(y0=55, y1=75,  fillcolor='rgba(34,197,94,0.06)',  line_width=0)
    fig.add_hrect(y0=75, y1=100, fillcolor='rgba(22,163,74,0.06)',  line_width=0)

    fig.add_trace(go.Scatter(
        x=df['date'], y=df['score'],
        mode='lines', name='Daily Score',
        line=dict(color='rgba(96,165,250,0.4)', width=1),
        hovertemplate='<b>%{x|%Y-%m-%d}</b><br>Score: %{y:.1f}<extra></extra>'
    ))
    fig.add_trace(go.Scatter(
        x=df['date'], y=df['ma_20'],
        mode='lines', name='20일 이동평균',
        line=dict(color='#f59e0b', width=2),
        hovertemplate='20MA: %{y:.1f}<extra></extra>'
    ))
    fig.add_trace(go.Scatter(
        x=df['date'], y=df['ma_60'],
        mode='lines', name='60일 이동평균',
        line=dict(color='#f87171', width=2),
        hovertemplate='60MA: %{y:.1f}<extra></extra>'
    ))

    fig.add_hline(y=50, line_dash='dash', line_color='rgba(255,255,255,0.3)', line_width=1)

    fig.update_layout(
        title=dict(text='이동평균 트렌드', font=dict(color='white', size=15)),
        xaxis=dict(color='white', gridcolor='rgba(75,75,75,0.3)'),
        yaxis=dict(title='Score', range=[0, 100], color='white', gridcolor='rgba(75,75,75,0.3)'),
        plot_bgcolor='#0e1117',
        paper_bgcolor='#0e1117',
        font=dict(color='white'),
        hovermode='x unified',
        height=380,
        showlegend=True,
        legend=dict(orientation='h', y=1.02, x=1, xanchor='right', font=dict(color='white')),
        margin=dict(l=60, r=60, t=50, b=40)
    )
    return fig


# ==================== 대차대조표 관련 ====================

SERIES_INFO = {
    "총자산 (Total Assets)": {
        "id": "WALCL",
        "highlight": True,
        "category": "자산 (Assets)",
        "description": "연준의 전체 자산 규모",
        "liquidity_impact": "증가 시 시장 유동성 ↑",
        "order": 1,
        "show_chart": True
    },
    "연준 보유 증권 (Securities Held)": {
        "id": "WSHOSHO",
        "highlight": False,
        "category": "자산 (Assets)",
        "description": "연준이 보유한 국채 및 MBS",
        "liquidity_impact": "증가 시 시장 유동성 ↑",
        "order": 2,
        "show_chart": False
    },
    "SRF (상설레포)": {
        "id": "RPONTSYD",
        "highlight": True,
        "category": "자산 (Assets)",
        "description": "은행에 제공하는 단기 대출",
        "liquidity_impact": "증가 시 은행 유동성 ↑",
        "order": 3,
        "show_chart": True
    },
    "대출 (Loans)": {
        "id": "WLCFLL",
        "highlight": False,
        "category": "자산 (Assets)",
        "description": "연준의 금융기관 대출",
        "liquidity_impact": "증가 시 시장 유동성 ↑",
        "order": 4,
        "show_chart": False
    },
    "  ㄴ Primary Credit": {
        "id": "WLCFLPCL",
        "highlight": True,
        "category": "자산 (Assets)",
        "description": "할인창구 1차 신용대출",
        "liquidity_impact": "증가 시 은행 유동성 ↑",
        "order": 5,
        "show_chart": True
    },
    "  ㄴ Secondary Credit": {
        "id": "WLCFLSCL",
        "highlight": False,
        "category": "자산 (Assets)",
        "description": "할인창구 2차 신용대출",
        "liquidity_impact": "증가 시 은행 유동성 ↑",
        "order": 6,
        "show_chart": False
    },
    "  ㄴ Seasonal Credit": {
        "id": "WLCFLSECL",
        "highlight": False,
        "category": "자산 (Assets)",
        "description": "할인창구 계절성 신용대출",
        "liquidity_impact": "증가 시 은행 유동성 ↑",
        "order": 7,
        "show_chart": False
    },
    "지급준비금 (Reserve Balances)": {
        "id": "WRESBAL",
        "highlight": True,
        "category": "부채 (Liabilities)",
        "description": "은행들이 연준에 예치한 자금",
        "liquidity_impact": "증가 시 은행 유동성 ↑",
        "order": 8,
        "show_chart": True
    },
    "TGA (재무부 일반계정)": {
        "id": "WTREGEN",
        "highlight": True,
        "category": "부채 (Liabilities)",
        "description": "미 재무부의 연준 예금",
        "liquidity_impact": "증가 시 시장 유동성 ↓",
        "order": 9,
        "show_chart": True
    },
    "RRP (역레포)": {
        "id": "RRPONTSYD",
        "highlight": True,
        "category": "부채 (Liabilities)",
        "description": "MMF 등의 초단기 자금 흡수",
        "liquidity_impact": "증가 시 시장 유동성 ↓",
        "order": 10,
        "show_chart": True
    },
    "MMF (Money Market Funds)": {
        "id": "MMMFFAQ027S",
        "highlight": True,
        "category": "부채 (Liabilities)",
        "description": "머니마켓펀드 총 자산 (분기별)",
        "liquidity_impact": "증가 시 현금 보유 선호 ↑",
        "order": 11,
        "show_chart": True,
        "is_quarterly": True
    },
    "Retail MMF": {
        "id": "WRMFNS",
        "highlight": False,
        "category": "부채 (Liabilities)",
        "description": "개인투자자용 머니마켓펀드",
        "liquidity_impact": "증가 시 현금 보유 선호 ↑",
        "order": 12,
        "show_chart": False
    },
    "총부채 (Total Liabilities)": {
        "id": "WALCL",
        "highlight": False,
        "category": "부채 (Liabilities)",
        "description": "연준의 전체 부채 규모",
        "liquidity_impact": "구조 변화가 유동성에 영향",
        "order": 13,
        "show_chart": False
    }
}

def format_number(value):
    if pd.isna(value):
        return "N/A"
    return f"{value:,.0f}"

def format_change(change):
    if pd.isna(change):
        return "N/A"
    if change > 0:
        return f"▲ {abs(change):,.0f}"
    elif change < 0:
        return f"▼ {abs(change):,.0f}"
    else:
        return f"{change:,.0f}"

def get_fred_link(series_id):
    return f"https://fred.stlouisfed.org/series/{series_id}"

def create_balance_sheet_chart(df, title, series_id):
    if df is None or len(df) == 0:
        return None
    df_work = df.copy()
    if isinstance(df_work.index, pd.DatetimeIndex):
        df_work = df_work.reset_index()
        if 'index' in df_work.columns:
            df_work = df_work.rename(columns={'index': 'date'})
    if 'date' not in df_work.columns:
        df_work['date'] = df_work.index
    df_sorted = df_work.sort_values('date')
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df_sorted['date'],
        y=df_sorted['value'],
        mode='lines+markers',
        name=title,
        line=dict(color='#64b5f6', width=2),
        marker=dict(size=6, color='#64b5f6'),
        hovertemplate='<b>%{x|%Y-%m-%d}</b><br>값: $%{y:,.0f}M<extra></extra>'
    ))
    fig.update_layout(
        title=dict(text=f"{title} - 최근 추이", font=dict(size=18, color='white')),
        xaxis=dict(title="날짜", gridcolor='#2d2d2d', color='white'),
        yaxis=dict(title="금액 ($M)", gridcolor='#2d2d2d', color='white'),
        plot_bgcolor='#0e1117',
        paper_bgcolor='#0e1117',
        font=dict(color='white'),
        hovermode='x unified',
        height=400
    )
    return fig

# ==================== 금리 스프레드 관련 ====================

SPREADS = {
    "SOFR-IORB": {
        "name": "SOFR - IORB",
        "series": ["SOFR", "IORB"],
        "multiplier": 1000,
        "threshold_min": 0,
        "threshold_max": 10,
        "description": "은행간 신뢰도 및 유동성 선호 지표",
        "normal_range": "0 ~ +10bp",
        "interpretation": "양수: 은행간 거래 활발 (정상) / 0에 근접 또는 음수: 은행들이 서로를 포기하고 연준 예치 선호 (신뢰 위기)",
        "signals": {
            "crisis": (float('-inf'), 0, "🚨 은행간 신뢰 붕괴 - 연준 예치 선호"),
            "warning": (0, 2, "⚠️ 은행간 거래 위축 - 주의 필요"),
            "normal": (2, 10, "✅ 정상 - 은행간 거래 활발"),
            "tight": (10, float('inf'), "📈 레포시장 타이트 - 담보 수요 증가")
        }
    },
    "EFFR-IORB": {
        "name": "EFFR - IORB",
        "series": ["EFFR", "IORB"],
        "multiplier": 1000,
        "threshold_min": -10,
        "threshold_max": 10,
        "description": "연준 금리 통제력",
        "normal_range": "-10 ~ +10bp",
        "interpretation": "양수: 준비금 부족/유동성 타이트 / 음수: 초과 준비금/유동성 풍부",
        "signals": {
            "tight": (10, float('inf'), "⚠️ 초단기 유동성 타이트 - 준비금 부족"),
            "normal": (-10, 10, "✅ 정상 범위 (정책 운용 변동 포함)"),
            "loose": (float('-inf'), -10, "💧 초과 준비금 (유동성 풍부)")
        }
    },
    "SOFR-RRP": {
        "name": "SOFR - RRP",
        "series": ["SOFR", "RRPONTSYAWARD"],
        "multiplier": 1000,
        "threshold_min": 0,
        "threshold_max": 10,
        "description": "민간 담보시장 vs 연준 유동성 흡수",
        "normal_range": "0 ~ +10bp",
        "interpretation": "양수: 정상 / >10bp: 담보 부족/레포시장 긴장 / 음수: 비정상",
        "signals": {
            "stress": (10, float('inf'), "⚠️ 레포시장 스트레스 - 담보 부족"),
            "normal": (0, 10, "✅ 보통 변동"),
            "abnormal": (float('-inf'), 0, "🔍 비정상 - 데이터/정책 확인 필요")
        }
    },
    "DGS3MO-EFFR": {
        "name": "3M Treasury - EFFR",
        "series": ["DGS3MO", "EFFR"],
        "multiplier": 100,
        "threshold_min": -20,
        "threshold_max": 20,
        "description": "단기 금리 기대 및 정책 방향 신호",
        "normal_range": "-20 ~ +20bp",
        "interpretation": "<-20bp: 금리 인하 예상 / 중립: 균형 / >20bp: 금리 인상 기대",
        "signals": {
            "easing": (float('-inf'), -20, "🔽 금리 인하 예상 (완화 기대)"),
            "neutral": (-20, 20, "✅ 중립 (명확한 기대 신호 없음)"),
            "tightening": (20, float('inf'), "🔼 금리 인상 기대 (긴축 신호)")
        }
    },
    "DGS10-DGS2": {
        "name": "10Y - 2Y Yield Curve",
        "series": ["DGS10", "DGS2"],
        "multiplier": 100,
        "threshold_min": 0,
        "threshold_max": 50,
        "description": "경기 사이클 신호 (전통적 침체 지표)",
        "normal_range": "0 ~ +50bp",
        "interpretation": "음수(역전): 경기침체 신호 / 0~50bp: 정상 / >50bp: 가파른 성장 기대",
        "signals": {
            "severe_inversion": (float('-inf'), -50, "🚨 강한 침체 리스크 (심층 분석 권장)"),
            "mild_inversion": (-50, 0, "⚠️ 곡선 역전 - 경기침체 경고"),
            "normal": (0, 50, "✅ 정상 (완만한 우상향)"),
            "steep": (50, float('inf'), "📈 가파른 곡선 (강한 성장/인플레 기대)")
        }
    },
    "DGS10-DGS3MO": {
        "name": "10Y - 3M Yield Curve",
        "series": ["DGS10", "DGS3MO"],
        "multiplier": 100,
        "threshold_min": 0,
        "threshold_max": 100,
        "description": "정책 신뢰 기반 침체 지표",
        "normal_range": "0 ~ +100bp",
        "interpretation": "<-50bp: 매우 강한 침체 신호 / 0~100bp: 정상 / >100bp: 장단기 프리미엄",
        "signals": {
            "strong_recession": (float('-inf'), -50, "🚨 매우 강한 침체 선행 신호"),
            "recession_warning": (-50, 0, "⚠️ 침체 우려 레벨"),
            "normal": (0, 100, "✅ 정상-완만"),
            "steep": (100, float('inf'), "📈 장단기 프리미엄 (성장/인플레 기대)")
        }
    },
    "STLFSI4": {
        "name": "금융 스트레스 인덱스",
        "series": ["STLFSI4"],
        "multiplier": 1,
        "threshold_min": -0.5,
        "threshold_max": 0.5,
        "description": "세인트루이스 연준 금융 스트레스 지표",
        "normal_range": "-0.5 ~ +0.5",
        "interpretation": "0 기준: 평균 스트레스 / 양수: 스트레스 증가 / 음수: 스트레스 감소",
        "signals": {
            "severe_stress": (1.5, float('inf'), "🚨 심각한 금융 스트레스"),
            "elevated_stress": (0.5, 1.5, "⚠️ 높은 스트레스"),
            "normal": (-0.5, 0.5, "✅ 정상 범위"),
            "low_stress": (float('-inf'), -0.5, "💚 낮은 스트레스")
        },
        "is_single_series": True,
        "show_ma": True
    },
    "DRTSCILM": {
        "name": "은행 대출 기준 (SLOOS)",
        "series": ["DRTSCILM"],
        "multiplier": 1,
        "threshold_min": 0,
        "threshold_max": 20,
        "description": "은행 대출 기준 강화 비율 (위기 선행지표)",
        "normal_range": "0 ~ +20%",
        "interpretation": "높을수록 은행들이 대출 기준을 강화 → 신용 경색 우려 / 낮을수록 대출 여건 개선",
        "signals": {
            "severe_tightening": (50, float('inf'), "🚨 극심한 대출 긴축 - 위기 임박 신호"),
            "tightening": (20, 50, "⚠️ 대출 기준 강화 - 신용 경색 우려"),
            "normal": (0, 20, "✅ 보통 수준"),
            "easing": (float('-inf'), 0, "💚 대출 기준 완화")
        },
        "is_single_series": True,
        "show_ma": False
    }
}

def calculate_spread(spread_info, api_key, start_date, end_date=None):
    if spread_info.get('is_single_series', False):
        series_id = spread_info['series'][0]
        df = fetch_fred_data(series_id, api_key, limit=None, start_date=start_date, end_date=end_date)
        if df is None:
            return None, None, None
        df = df.set_index('date')
        df['spread'] = df['value'] * spread_info['multiplier']
        if spread_info.get('show_ma', False):
            df['ma_4w'] = df['spread'].rolling(window=4, min_periods=1).mean()
        latest_value = df['spread'].iloc[0] if len(df) > 0 else None
        df_components = df[['value']].copy()
        df_components.columns = [series_id]
        return df, latest_value, df_components

    series1_id, series2_id = spread_info['series']
    df1 = fetch_fred_data(series1_id, api_key, limit=None, start_date=start_date, end_date=end_date)
    df2 = fetch_fred_data(series2_id, api_key, limit=None, start_date=start_date, end_date=end_date)
    if df1 is None or df2 is None:
        return None, None, None
    df1 = df1.set_index('date')
    df2 = df2.set_index('date')
    df = df1.join(df2, how='outer', rsuffix='_2')
    df.columns = [series1_id, series2_id]
    df = df.ffill().dropna()
    df = df.sort_index(ascending=False)
    df['spread'] = (df[series1_id] - df[series2_id]) * spread_info['multiplier']
    latest_value = df['spread'].iloc[0] if len(df) > 0 else None
    return df, latest_value, df[[series1_id, series2_id]]

def get_signal_status(value, signals):
    for signal_name, (min_val, max_val, message) in signals.items():
        if min_val <= value < max_val:
            return message
    return "📊 데이터 확인 필요"

def create_spread_chart(df, spread_name, spread_info, latest_value):
    df_sorted = df.sort_index(ascending=True)
    fig = go.Figure()
    if spread_info.get('is_single_series', False):
        series_id = spread_info['series'][0]
        fig.add_trace(go.Scatter(
            x=df_sorted.index, y=df_sorted['spread'],
            mode='lines', name=series_id,
            line=dict(color='#2E86DE', width=2)
        ))
        if spread_info.get('show_ma', False) and 'ma_4w' in df_sorted.columns:
            fig.add_trace(go.Scatter(
                x=df_sorted.index, y=df_sorted['ma_4w'],
                mode='lines', name='4주 이동평균',
                line=dict(color='#FF6B6B', width=2, dash='dash')
            ))
        fig.add_hline(y=0, line_dash="dash", line_color="gray", opacity=0.5,
                      annotation_text="평균 수준" if series_id == "STLFSI4" else "기준선")
    else:
        fig.add_trace(go.Scatter(
            x=df_sorted.index, y=df_sorted['spread'],
            mode='lines', name='Spread',
            line=dict(color='#2E86DE', width=2)
        ))

    if 'signals' in spread_info:
        colors_map = {
            'normal': 'green', 'neutral': 'green', 'mild_inversion': 'orange',
            'recession_warning': 'orange', 'easing': 'lightblue', 'tightening': 'pink',
            'stress': 'red', 'severe_inversion': 'red', 'strong_recession': 'red',
            'tight': 'orange', 'abnormal': 'gray', 'loose': 'lightgreen',
            'steep': 'lightblue', 'severe_stress': 'red', 'elevated_stress': 'orange',
            'low_stress': 'lightgreen', 'crisis': 'red', 'warning': 'orange',
            'severe_tightening': 'red'
        }
        for signal_name, (min_val, max_val, message) in spread_info['signals'].items():
            if min_val != float('-inf') and max_val != float('inf'):
                color = colors_map.get(signal_name, 'gray')
                fig.add_hrect(
                    y0=min_val, y1=max_val, fillcolor=color, opacity=0.1,
                    line_width=0,
                    annotation_text=message.split(' - ')[0] if ' - ' in message else message,
                    annotation_position="left"
                )

    y_axis_title = "Index Value" if spread_info.get('is_single_series', False) else "Basis Points (bp)"
    if spread_info.get('is_single_series', False) and spread_info['series'][0] == 'DRTSCILM':
        y_axis_title = "Percentage (%)"

    fig.update_layout(
        title=f"{spread_name} ({spread_info['normal_range']})",
        xaxis_title="날짜", yaxis_title=y_axis_title,
        hovermode='x unified', height=400, showlegend=True
    )
    return fig

def create_components_chart(df_components, series_ids):
    df_sorted = df_components.sort_index(ascending=True)
    fig = go.Figure()
    colors = ['#EE5A6F', '#4ECDC4']
    for i, series in enumerate(series_ids):
        fig.add_trace(go.Scatter(
            x=df_sorted.index, y=df_sorted[series],
            mode='lines', name=series,
            line=dict(color=colors[i], width=2)
        ))
    fig.update_layout(
        title="구성 요소", xaxis_title="날짜", yaxis_title="Rate (%)",
        hovermode='x unified', height=300, showlegend=True
    )
    return fig

def get_fear_greed_index():
    try:
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if 'fear_and_greed' in data:
                score = float(data['fear_and_greed']['score'])
                rating = data['fear_and_greed']['rating']
                if score >= 75:
                    status, color, emoji = "Extreme Greed", "#16a34a", "🤑"
                elif score >= 55:
                    status, color, emoji = "Greed", "#22c55e", "😊"
                elif score >= 45:
                    status, color, emoji = "Neutral", "#eab308", "😐"
                elif score >= 25:
                    status, color, emoji = "Fear", "#f97316", "😨"
                else:
                    status, color, emoji = "Extreme Fear", "#dc2626", "😱"
                return {"score": score, "status": status, "rating": rating,
                        "color": color, "emoji": emoji, "source": "CNN API"}
    except:
        pass

    try:
        url = "https://api.alternative.me/fng/?limit=1"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if 'data' in data and len(data['data']) > 0:
                score = float(data['data'][0]['value'])
                if score >= 75:
                    status, color, emoji = "Extreme Greed", "#16a34a", "🤑"
                elif score >= 55:
                    status, color, emoji = "Greed", "#22c55e", "😊"
                elif score >= 45:
                    status, color, emoji = "Neutral", "#eab308", "😐"
                elif score >= 25:
                    status, color, emoji = "Fear", "#f97316", "😨"
                else:
                    status, color, emoji = "Extreme Fear", "#dc2626", "😱"
                return {"score": score, "status": status,
                        "rating": data['data'][0]['value_classification'],
                        "color": color, "emoji": emoji, "source": "Crypto F&G (참고용)"}
    except:
        pass

    try:
        df_vix = fetch_fred_data("VIXCLS", FRED_API_KEY, limit=1)
        if df_vix is not None and len(df_vix) > 0:
            vix_value = float(df_vix.iloc[0]["value"])
            if vix_value <= 12: score = 85
            elif vix_value <= 15: score = 75
            elif vix_value <= 20: score = 60
            elif vix_value <= 25: score = 50
            elif vix_value <= 30: score = 40
            elif vix_value <= 35: score = 30
            elif vix_value <= 40: score = 20
            else: score = 10
            if score >= 75:
                status, color, emoji = "Extreme Greed", "#16a34a", "🤑"
            elif score >= 55:
                status, color, emoji = "Greed", "#22c55e", "😊"
            elif score >= 45:
                status, color, emoji = "Neutral", "#eab308", "😐"
            elif score >= 25:
                status, color, emoji = "Fear", "#f97316", "😨"
            else:
                status, color, emoji = "Extreme Fear", "#dc2626", "😱"
            return {"score": score, "status": status,
                    "rating": f"VIX 기반 추정 (VIX: {vix_value:.2f})",
                    "color": color, "emoji": emoji, "source": "VIX 기반 계산"}
    except Exception as e:
        st.error(f"모든 Fear & Greed 데이터 소스 실패: {e}")
    return None

def get_vix_index():
    try:
        df_vix = fetch_fred_data("VIXCLS", FRED_API_KEY, limit=1)
        if df_vix is not None and len(df_vix) > 0:
            vix_value = float(df_vix.iloc[0]["value"])
            if vix_value < 12:
                status, color, emoji, description = "매우 낮음", "#16a34a", "😌", "시장 매우 안정"
            elif vix_value < 20:
                status, color, emoji, description = "낮음", "#22c55e", "🙂", "시장 안정"
            elif vix_value < 30:
                status, color, emoji, description = "보통", "#eab308", "😐", "변동성 증가"
            elif vix_value < 40:
                status, color, emoji, description = "높음", "#f97316", "😰", "시장 불안"
            else:
                status, color, emoji, description = "매우 높음", "#dc2626", "🚨", "극심한 불안"
            return {"value": vix_value, "status": status, "color": color,
                    "emoji": emoji, "description": description}
    except Exception as e:
        st.error(f"VIX 데이터 로딩 실패: {e}")
    return None

# ==================== 메인 앱 ====================

def main():
    st.title("📊 Fed 모니터링 통합 대시보드")

    col1, col2 = st.columns([6, 1])
    with col1:
        st.caption(f"마지막 업데이트: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    with col2:
        if st.button("🔄 새로고침"):
            st.cache_data.clear()
            st.rerun()

    if not FRED_API_KEY:
        st.warning("⚠️ FRED API 키가 설정되지 않았습니다.")
        st.info("""
        **FRED API 키 발급:**
        https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료로 발급받을 수 있습니다.
        
        **Streamlit Cloud Secrets 설정:**
        1. Streamlit Cloud 대시보드에서 앱 선택
        2. Settings → Secrets 메뉴 클릭
        3. `FRED_API_KEY = "your_api_key_here"` 형식으로 입력
        """)
        return

    # 메인 탭 생성 (tab3 추가)
    tab1, tab2, tab3 = st.tabs([
        "💰 Fed Balance Sheet",
        "📈 금리 스프레드",
        "😨 Fear & Greed 히스토리"
    ])

    # ==================== Tab 1: Fed Balance Sheet ====================
    with tab1:
        st.header("Fed Balance Sheet: Weekly Changes (Unit: $M)")

        with st.sidebar:
            st.markdown("### 📅 조회 기간 설정 (Balance Sheet)")
            bs_date_mode = st.radio("기간 선택 방식", ["빠른 선택", "직접 입력"], index=0, key="bs_date_mode")
            if bs_date_mode == "빠른 선택":
                bs_period = st.selectbox("조회 기간",
                    ["1개월", "3개월", "6개월", "1년", "2년", "5년"], index=3, key="bs_period")
                bs_period_map = {"1개월": 30, "3개월": 90, "6개월": 180, "1년": 365, "2년": 730, "5년": 1825}
                bs_days = bs_period_map[bs_period]
                bs_start_date = (datetime.now() - timedelta(days=bs_days)).strftime('%Y-%m-%d')
                bs_end_date = datetime.now().strftime('%Y-%m-%d')
            else:
                col1, col2 = st.columns(2)
                with col1:
                    bs_start_date_input = st.date_input("시작 날짜",
                        value=datetime.now() - timedelta(days=365),
                        max_value=datetime.now(), key="bs_start")
                with col2:
                    bs_end_date_input = st.date_input("종료 날짜",
                        value=datetime.now(), max_value=datetime.now(), key="bs_end")
                bs_start_date = bs_start_date_input.strftime('%Y-%m-%d')
                bs_end_date = bs_end_date_input.strftime('%Y-%m-%d')

        st.info(f"📅 **조회 기간**: {bs_start_date} ~ {bs_end_date}")

        with st.spinner("데이터를 불러오는 중..."):
            data_list = []
            chart_data = {}

            for name, info in SERIES_INFO.items():
                series_id = info["id"]
                highlight = info["highlight"]
                category = info["category"]
                description = info["description"]
                liquidity_impact = info["liquidity_impact"]
                order = info["order"]
                show_chart = info.get("show_chart", False)
                is_quarterly = info.get("is_quarterly", False)

                df = fetch_fred_data(series_id, FRED_API_KEY, limit=10)

                if show_chart:
                    df_chart = fetch_fred_data(series_id, FRED_API_KEY, limit=None,
                                               start_date=bs_start_date, end_date=bs_end_date)
                    chart_data[name] = {"df": df_chart, "series_id": series_id}

                if df is not None and len(df) >= 2:
                    current_value = df.iloc[0]["value"]
                    previous_value = df.iloc[1]["value"]
                    change = current_value - previous_value
                    current_date = df.iloc[0]["date"]
                    previous_date = df.iloc[1]["date"]

                    display_name = name
                    if is_quarterly:
                        display_name = f"{name} 🔶"
                        current_quarter = (current_date.month - 1) // 3 + 1
                        previous_quarter = (previous_date.month - 1) // 3 + 1
                        current_date_str = f"{current_date.year}-Q{current_quarter}"
                        previous_date_str = f"{previous_date.year}-Q{previous_quarter}"
                    else:
                        current_date_str = current_date.strftime('%Y-%m-%d')
                        previous_date_str = previous_date.strftime('%Y-%m-%d')

                    data_list.append({
                        "분류": category, "항목": display_name, "설명": description,
                        "현재 값": format_number(current_value), "이전 값": format_number(previous_value),
                        "변화": format_change(change), "유동성 영향": liquidity_impact,
                        "출처": f'<a href="{get_fred_link(series_id)}" target="_blank">🔗 {series_id}</a>',
                        "하이라이트": highlight, "변화_수치": change, "순서": order,
                        "현재_날짜": current_date_str, "이전_날짜": previous_date_str
                    })
                else:
                    display_name = f"{name} 🔶" if is_quarterly else name
                    data_list.append({
                        "분류": category, "항목": display_name, "설명": description,
                        "현재 값": "N/A", "이전 값": "N/A", "변화": "N/A",
                        "유동성 영향": liquidity_impact,
                        "출처": f'<a href="{get_fred_link(series_id)}" target="_blank">🔗 {series_id}</a>',
                        "하이라이트": highlight, "변화_수치": 0, "순서": order,
                        "현재_날짜": "N/A", "이전_날짜": "N/A"
                    })

        if data_list:
            df_display = pd.DataFrame(data_list)
            df_display = df_display.sort_values(by=["순서"])

            if "현재_날짜" in df_display.columns and df_display["현재_날짜"].iloc[0] != "N/A":
                st.info(f"ℹ️ **데이터 기준**: {df_display['현재_날짜'].iloc[0]} 기준")

            st.markdown("### 📊 Fed Balance Sheet 데이터")
            st.caption("🔶 = 분기별 업데이트 항목")

            html_table = "<table style='width:100%; border-collapse: collapse;'>"
            html_table += "<thead><tr style='background-color: #2d2d2d;'>"
            for h in ["분류", "항목", "설명", "현재 날짜", "현재 값", "이전 날짜", "이전 값", "변화", "유동성 영향", "출처"]:
                html_table += f"<th style='padding: 12px; text-align: left; color: white;'>{h}</th>"
            html_table += "</tr></thead><tbody>"

            current_category = None
            for _, row in df_display.iterrows():
                bg_color = "#3d3d00" if row["하이라이트"] else "#1e1e1e"
                border_style = "border: 2px solid #ffd700;" if row["하이라이트"] else ""
                indent_style = "padding-left: 30px;" if row["항목"].startswith("  ㄴ") else ""

                if current_category != row["분류"]:
                    if current_category is not None:
                        html_table += "<tr style='height: 10px; background-color: #0e1117;'><td colspan='10'></td></tr>"
                    current_category = row["분류"]

                change_text = row["변화"]
                change_color = "color: #4ade80;" if "▲" in change_text else ("color: #f87171;" if "▼" in change_text else "color: white;")
                liquidity_text = row["유동성 영향"]
                liquidity_color = "color: #4ade80;" if ("↑" in liquidity_text and "유동성" in liquidity_text) else ("color: #f87171;" if "↓" in liquidity_text else "color: #fbbf24;")

                html_table += f"<tr style='background-color: {bg_color}; {border_style}'>"
                html_table += f"<td style='padding: 12px; color: #9ca3af; font-weight: 600; font-size: 13px;'>{row['분류']}</td>"
                html_table += f"<td style='padding: 12px; {indent_style} color: white; font-size: 14px;'>{row['항목']}</td>"
                html_table += f"<td style='padding: 12px; color: #d1d5db; font-size: 13px;'>{row['설명']}</td>"
                html_table += f"<td style='padding: 12px; text-align: center; color: #60a5fa; font-size: 12px;'>{row['현재_날짜']}</td>"
                html_table += f"<td style='padding: 12px; text-align: right; color: white; font-size: 14px;'>{row['현재 값']}</td>"
                html_table += f"<td style='padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;'>{row['이전_날짜']}</td>"
                html_table += f"<td style='padding: 12px; text-align: right; color: white; font-size: 14px;'>{row['이전 값']}</td>"
                html_table += f"<td style='padding: 12px; text-align: right; {change_color} font-size: 14px;'><b>{change_text}</b></td>"
                html_table += f"<td style='padding: 12px; {liquidity_color} font-size: 13px;'><b>{liquidity_text}</b></td>"
                html_table += f"<td style='padding: 12px; text-align: center; font-size: 13px;'>{row['출처']}</td>"
                html_table += "</tr>"

            html_table += "</tbody></table>"
            st.markdown(html_table, unsafe_allow_html=True)

            st.markdown("---")
            st.markdown(f"### 📈 주요 항목 추이 ({bs_start_date} ~ {bs_end_date})")

            chart_names = list(chart_data.keys())
            for i in range(0, len(chart_names), 2):
                cols = st.columns(2)
                for j, col in enumerate(cols):
                    if i + j < len(chart_names):
                        name = chart_names[i + j]
                        data = chart_data[name]
                        with col:
                            fig = create_balance_sheet_chart(data["df"], name, data["series_id"])
                            if fig:
                                st.plotly_chart(fig, use_container_width=True)

            st.markdown("---")
            with st.expander("📌 항목별 상세 설명 보기"):
                st.markdown("""
                #### 💰 자산 항목 (Assets)
                - **총자산**: 연준 대차대조표의 전체 자산 규모.
                - **연준 보유 증권**: 국채와 MBS 매입으로 유동성 공급.
                - **SRF (상설레포)**: 은행이 담보를 제공하고 연준으로부터 단기 자금 조달.
                - **대출**: 연준이 금융기관에 제공하는 긴급 유동성.
                
                #### 💳 부채 항목 (Liabilities)
                - **지급준비금**: 은행들이 연준에 예치한 초과 준비금.
                - **TGA (재무부 일반계정)**: 미 재무부가 연준에 보관하는 현금.
                - **RRP (역레포)**: MMF 등이 초단기로 연준에 자금을 예치하는 제도.
                - **MMF**: 머니마켓펀드 총 자산 규모. *분기별 업데이트*.
                """)

        st.caption("데이터 출처: Federal Reserve Economic Data (FRED)")

    # ==================== Tab 2: 금리 스프레드 ====================
    with tab2:
        st.header("금리 스프레드 모니터링")

        with st.sidebar:
            st.markdown("### 📅 조회 기간 설정")
            date_mode = st.radio("기간 선택 방식", ["빠른 선택", "직접 입력"], index=0, key="spread_date_mode")
            if date_mode == "빠른 선택":
                period = st.selectbox("조회 기간",
                    ["1개월", "3개월", "6개월", "1년", "2년", "5년", "10년", "전체"],
                    index=3, key="spread_period")
                period_map = {"1개월": 30, "3개월": 90, "6개월": 180, "1년": 365,
                              "2년": 730, "5년": 1825, "10년": 3650, "전체": 365 * 20}
                start_date = (datetime.now() - timedelta(days=period_map[period])).strftime('%Y-%m-%d')
                end_date = datetime.now().strftime('%Y-%m-%d')
            else:
                col1, col2 = st.columns(2)
                with col1:
                    start_date_input = st.date_input("시작 날짜",
                        value=datetime.now() - timedelta(days=365),
                        max_value=datetime.now(), key="spread_start")
                with col2:
                    end_date_input = st.date_input("종료 날짜",
                        value=datetime.now(), max_value=datetime.now(), key="spread_end")
                start_date = start_date_input.strftime('%Y-%m-%d')
                end_date = end_date_input.strftime('%Y-%m-%d')

            st.markdown("---")
            st.markdown("### 📊 스프레드 정보")
            st.markdown("""
            **주요 스프레드:**
            
            **1. SOFR - IORB**: 은행간 신뢰도  
            **2. EFFR - IORB**: 연준 금리 통제력  
            **3. SOFR - RRP**: 민간 담보시장 vs 연준 유동성 흡수  
            **4. 3M TB - EFFR**: 단기 금리 기대  
            **5. 10Y - 2Y**: 경기 사이클 신호  
            **6. 10Y - 3M**: 정책 신뢰 기반 침체 지표  
            **7. STLFSI4**: 금융 스트레스 종합 지표  
            **8. SLOOS 은행 대출 기준**: 위기 선행 지표  
            """)

        st.info(f"📅 **조회 기간**: {start_date} ~ {end_date}")

        st.markdown("---")
        st.subheader("🎭 시장 심리 지표")

        indicator_cols = st.columns(2)

        with indicator_cols[0]:
            with st.spinner('Fear & Greed 지수 로딩 중...'):
                fg_data = get_fear_greed_index()
                if fg_data:
                    fig_fg = go.Figure(go.Indicator(
                        mode="gauge+number",
                        value=fg_data["score"],
                        domain={'x': [0, 1], 'y': [0, 1]},
                        title={'text': f"{fg_data['emoji']} Fear & Greed Index", 'font': {'size': 18, 'color': '#83858C'}},
                        number={'font': {'size': 40, 'color': '#83858C', 'family': 'Arial Black'}},
                        gauge={
                            'axis': {'range': [0, 100], 'tickwidth': 1, 'tickcolor': "#83858C"},
                            'bar': {'color': fg_data["color"], 'thickness': 0.75},
                            'bgcolor': "white", 'borderwidth': 2, 'bordercolor': "gray",
                            'steps': [
                                {'range': [0, 25], 'color': '#fecaca'},
                                {'range': [25, 45], 'color': '#fed7aa'},
                                {'range': [45, 55], 'color': '#fef08a'},
                                {'range': [55, 75], 'color': '#bbf7d0'},
                                {'range': [75, 100], 'color': '#86efac'}
                            ],
                            'threshold': {'line': {'color': "black", 'width': 4}, 'thickness': 0.75, 'value': fg_data["score"]}
                        }
                    ))
                    fig_fg.update_layout(height=300, margin=dict(l=20, r=20, t=80, b=20),
                                         paper_bgcolor="rgba(0,0,0,0)", font={'color': "#83858C"})
                    st.plotly_chart(fig_fg, use_container_width=True)
                    st.markdown(f"""
                    <div style='text-align: center; padding: 15px; background-color: {fg_data['color']}20; 
                                border-radius: 10px; border: 2px solid {fg_data['color']};'>
                        <h3 style='color: {fg_data['color']}; margin: 0;'>{fg_data['emoji']} {fg_data['status']}</h3>
                        <p style='color: #83858C; margin: 5px 0 0 0; font-size: 14px;'>
                            Score: <span style='color: black; background-color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold;'>{fg_data['score']:.1f}/100</span>
                        </p>
                    </div>
                    """, unsafe_allow_html=True)
                    st.caption("0-25: Extreme Fear 😱 / 25-45: Fear 😨 / 45-55: Neutral 😐 / 55-75: Greed 😊 / 75-100: Extreme Greed 🤑")
                else:
                    st.error("Fear & Greed 데이터를 불러올 수 없습니다.")

        with indicator_cols[1]:
            with st.spinner('VIX 지수 로딩 중...'):
                vix_data = get_vix_index()
                if vix_data:
                    fig_vix = go.Figure(go.Indicator(
                        mode="gauge+number",
                        value=vix_data["value"],
                        domain={'x': [0, 1], 'y': [0, 1]},
                        title={'text': f"{vix_data['emoji']} VIX Index", 'font': {'size': 18, 'color': '#83858C'}},
                        number={'font': {'size': 40, 'color': '#83858C', 'family': 'Arial Black'}},
                        gauge={
                            'axis': {'range': [0, 80], 'tickwidth': 1, 'tickcolor': "#83858C"},
                            'bgcolor': "white", 'borderwidth': 2, 'bordercolor': "gray",
                            'steps': [
                                {'range': [0, 12], 'color': '#86efac'},
                                {'range': [12, 20], 'color': '#bbf7d0'},
                                {'range': [20, 30], 'color': '#fef08a'},
                                {'range': [30, 40], 'color': '#fed7aa'},
                                {'range': [40, 80], 'color': '#fecaca'}
                            ],
                            'threshold': {'line': {'color': "black", 'width': 4}, 'thickness': 0.75, 'value': vix_data["value"]}
                        }
                    ))
                    fig_vix.update_layout(height=300, margin=dict(l=20, r=20, t=80, b=20),
                                          paper_bgcolor="rgba(0,0,0,0)", font={'color': "#83858C"})
                    st.plotly_chart(fig_vix, use_container_width=True)
                    st.markdown(f"""
                    <div style='text-align: center; padding: 15px; background-color: {vix_data['color']}20; 
                                border-radius: 10px; border: 2px solid {vix_data['color']};'>
                        <h3 style='color: {vix_data['color']}; margin: 0;'>{vix_data['emoji']} {vix_data['status']}</h3>
                        <p style='color: #83858C; margin: 5px 0 0 0; font-size: 14px;'>
                            VIX: <span style='color: black; background-color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold;'>{vix_data['value']:.2f}</span> | {vix_data['description']}
                        </p>
                    </div>
                    """, unsafe_allow_html=True)
                    st.caption("<12: 매우 낮음 😌 / 12-20: 낮음 🙂 / 20-30: 보통 😐 / 30-40: 높음 😰 / >40: 매우 높음 🚨")
                else:
                    st.error("VIX 데이터를 불러올 수 없습니다.")

        st.markdown("---")
        st.subheader("📍 현재 상태")

        spreads_list = list(SPREADS.items())
        summary_cols_1 = st.columns(4)
        for idx, (key, spread_info) in enumerate(spreads_list[:4]):
            with summary_cols_1[idx]:
                with st.spinner(f'{spread_info["name"]} 로딩 중...'):
                    df_spread, latest_value, df_components = calculate_spread(spread_info, FRED_API_KEY, start_date, end_date)
                    if latest_value is not None:
                        status_msg = get_signal_status(latest_value, spread_info['signals']) if 'signals' in spread_info else ("✅ 정상" if spread_info['threshold_min'] <= latest_value <= spread_info['threshold_max'] else "⚠️ 주의")
                        value_unit = "" if spread_info.get('is_single_series', False) else "bp"
                        st.metric(label=spread_info['name'], value=f"{latest_value:.2f}{value_unit}",
                                  delta=status_msg.split(' - ')[0] if ' - ' in status_msg else status_msg)
                        st.caption(spread_info['description'])

        summary_cols_2 = st.columns(4)
        for idx, (key, spread_info) in enumerate(spreads_list[4:8]):
            with summary_cols_2[idx]:
                with st.spinner(f'{spread_info["name"]} 로딩 중...'):
                    df_spread, latest_value, df_components = calculate_spread(spread_info, FRED_API_KEY, start_date, end_date)
                    if latest_value is not None:
                        status_msg = get_signal_status(latest_value, spread_info['signals']) if 'signals' in spread_info else ("✅ 정상" if spread_info['threshold_min'] <= latest_value <= spread_info['threshold_max'] else "⚠️ 주의")
                        value_unit = "" if spread_info.get('is_single_series', False) else "bp"
                        st.metric(label=spread_info['name'], value=f"{latest_value:.2f}{value_unit}",
                                  delta=status_msg.split(' - ')[0] if ' - ' in status_msg else status_msg)
                        st.caption(spread_info['description'])

        st.markdown("---")
        st.subheader("🎯 연준 정책금리 프레임워크")

        with st.spinner('데이터 로딩 중...'):
            policy_series = {
                'SOFR': '담보부 익일물 금리', 'RRPONTSYAWARD': 'ON RRP (하한)',
                'IORB': '준비금 이자율', 'EFFR': '연방기금 실효금리',
                'DFEDTARL': 'FF 목표 하한', 'DFEDTARU': 'FF 목표 상한'
            }
            policy_data = {}
            for series_id in policy_series.keys():
                df = fetch_fred_data(series_id, FRED_API_KEY, limit=None, start_date=start_date, end_date=end_date)
                if df is not None:
                    policy_data[series_id] = df

            if len(policy_data) > 0:
                combined_df = pd.DataFrame()
                for series_id, df in policy_data.items():
                    df_indexed = df.set_index('date')
                    combined_df[series_id] = df_indexed['value']
                combined_df = combined_df.ffill().dropna()
                combined_df = combined_df.sort_index(ascending=True)

                fig = go.Figure()
                if 'DFEDTARL' in combined_df.columns and 'DFEDTARU' in combined_df.columns:
                    fig.add_trace(go.Scatter(x=combined_df.index, y=combined_df['DFEDTARU'],
                        mode='lines', name='FF 목표 상한', line=dict(color='rgba(200,200,200,0.3)', width=1, dash='dash')))
                    fig.add_trace(go.Scatter(x=combined_df.index, y=combined_df['DFEDTARL'],
                        mode='lines', name='FF 목표 하한', line=dict(color='rgba(200,200,200,0.3)', width=1, dash='dash'),
                        fill='tonexty', fillcolor='rgba(200,200,200,0.1)'))

                colors = {'SOFR': '#FF6B6B', 'RRPONTSYAWARD': '#4ECDC4', 'IORB': '#95E1D3', 'EFFR': '#F38181'}
                for series_id, label in policy_series.items():
                    if series_id in combined_df.columns and series_id not in ['DFEDTARL', 'DFEDTARU']:
                        fig.add_trace(go.Scatter(x=combined_df.index, y=combined_df[series_id],
                            mode='lines', name=f'{series_id} ({label})',
                            line=dict(color=colors.get(series_id, '#999999'), width=2)))

                fig.update_layout(title="연준 정책금리 프레임워크 및 시장 금리",
                                  xaxis_title="날짜", yaxis_title="금리 (%)",
                                  hovermode='x unified', height=500, showlegend=True,
                                  legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1))
                st.plotly_chart(fig, use_container_width=True)

                col1, col2 = st.columns(2)
                with col1:
                    st.info("**금리 조절 메커니즘:**\n- 목표 범위: FOMC 설정\n- IORB: 상한 역할\n- ON RRP: 하한 역할\n- EFFR: 실제 시장금리")
                with col2:
                    if len(combined_df) > 0:
                        latest = combined_df.iloc[-1]
                        st.success(f"**최신 금리 (%):**\n- SOFR: {latest.get('SOFR', 0):.2f}%\n- EFFR: {latest.get('EFFR', 0):.2f}%\n- IORB: {latest.get('IORB', 0):.2f}%\n- ON RRP: {latest.get('RRPONTSYAWARD', 0):.2f}%")

        st.markdown("---")
        st.subheader("📈 상세 차트")
        spread_tabs = st.tabs([spread_info['name'] for spread_info in SPREADS.values()])

        for idx, (key, spread_info) in enumerate(SPREADS.items()):
            with spread_tabs[idx]:
                with st.spinner('데이터 로딩 중...'):
                    df_spread, latest_value, df_components = calculate_spread(spread_info, FRED_API_KEY, start_date, end_date)
                    if df_spread is not None:
                        col1, col2 = st.columns([2, 1])
                        value_unit = "" if spread_info.get('is_single_series', False) else "bp"
                        with col1:
                            stat_cols = st.columns(4)
                            with stat_cols[0]: st.metric("현재 값", f"{latest_value:.2f}{value_unit}")
                            with stat_cols[1]: st.metric("평균", f"{df_spread['spread'].mean():.2f}{value_unit}")
                            with stat_cols[2]: st.metric("최대", f"{df_spread['spread'].max():.2f}{value_unit}")
                            with stat_cols[3]: st.metric("최소", f"{df_spread['spread'].min():.2f}{value_unit}")
                        with col2:
                            if 'signals' in spread_info:
                                current_signal = get_signal_status(latest_value, spread_info['signals'])
                                signal_lines = ["**현재 신호:**", current_signal, ""]
                            else:
                                signal_lines = []
                            st.info("\n".join(signal_lines + [
                                f"**정상 범위:** {spread_info['normal_range']}", "",
                                f"**의미:** {spread_info['description']}", "",
                                f"**해석:** {spread_info['interpretation']}"
                            ]))
                        st.plotly_chart(create_spread_chart(df_spread, spread_info['name'], spread_info, latest_value), use_container_width=True)
                        if not spread_info.get('is_single_series', False) and df_components is not None:
                            with st.expander("구성 요소 보기"):
                                st.plotly_chart(create_components_chart(df_components, spread_info['series']), use_container_width=True)
                                latest_components = df_components.iloc[0]
                                st.dataframe(pd.DataFrame({
                                    '지표': spread_info['series'],
                                    '현재 값 (%)': [f"{val:.4f}" for val in latest_components.values]
                                }), hide_index=True)
                    else:
                        st.error("데이터를 불러올 수 없습니다.")

        st.caption("데이터 출처: Federal Reserve Economic Data (FRED)")

    # ==================== Tab 3: Fear & Greed 히스토리 ====================
    with tab3:
        st.header("😨 Fear & Greed Index 전체 히스토리")
        st.caption("출처: CNN Business Fear & Greed Index (https://production.dataviz.cnn.io)")

        with st.spinner("CNN Fear & Greed 히스토리 데이터 로딩 중..."):
            history_data = fetch_fear_greed_full_history()

        if history_data is None:
            st.error("❌ Fear & Greed 히스토리 데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.")
            st.stop()

        df_fg = history_data.get('fg_history')

        if df_fg is None or len(df_fg) == 0:
            st.error("Fear & Greed 히스토리 데이터가 비어있습니다.")
            st.stop()

        # ── 데이터 커버리지 배너 ──
        # ── S&P 500 데이터: FRED SP500 시리즈로 F&G 전체 기간 확장 ──
        # CNN API는 1년치만 제공 → FRED SP500 시리즈(일별)로 F&G 전체 기간과 동기화
        df_sp500 = None
        fg_start_str = df_fg['date'].min().strftime('%Y-%m-%d')
        fg_end_str   = df_fg['date'].max().strftime('%Y-%m-%d')
        with st.spinner("S&P 500 장기 데이터 로딩 중 (FRED SP500)…"):
            _df_sp_fred = fetch_fred_data(
                'SP500', FRED_API_KEY, limit=None,
                start_date=fg_start_str, end_date=fg_end_str
            )
            if _df_sp_fred is not None and len(_df_sp_fred) > 0:
                df_sp500 = (
                    _df_sp_fred
                    .rename(columns={'value': 'price'})
                    .sort_values('date')
                    .reset_index(drop=True)
                )
            else:
                # FRED 실패 시 CNN 데이터 fallback (1년치)
                df_sp500 = history_data.get('sp500')

        # ── 데이터 커버리지 배너 (F&G + S&P 500) ──
        src_info = history_data.get('data_source_info', {})
        if src_info:
            start_d = src_info.get('start_date', fg_start_str)
            end_d   = src_info.get('end_date',   fg_end_str)
            total   = src_info.get('total_days', len(df_fg))
            has_old = src_info.get('has_old_csv', False)
            years   = round((df_fg['date'].max() - df_fg['date'].min()).days / 365.25, 1)
            fg_src  = "GitHub CSV(2011~) + CNN API" if has_old else "CNN API"
            sp_info = (f"S&P 500: FRED SP500 **{len(df_sp500):,}일**"
                       if df_sp500 is not None else "S&P 500: CNN API (1년)")
            st.success(
                f"✅ **데이터 로드 완료** | "
                f"F&G: **{start_d} ~ {end_d}** ({years}년 / {total:,}일) | "
                f"{sp_info} | 출처: {fg_src}"
            )

        # ── 현재 상태 요약 카드 ──
        current_info = history_data.get('current', {})
        latest_row   = df_fg.iloc[-1]
        # score: float 확보
        _raw_score   = current_info.get('score', latest_row.get('score', 50))
        try:
            latest_score = float(_raw_score)
        except (TypeError, ValueError):
            latest_score = 50.0
        # rating: str 확보 (None/NaN/float 방어)
        _raw_rating  = current_info.get('rating', latest_row.get('rating', None))
        if isinstance(_raw_rating, str) and _raw_rating.strip():
            latest_rating = _raw_rating.strip()
        else:
            latest_rating = _score_to_rating(latest_score)
        current_color = rating_to_color(latest_rating)

        prev_week  = current_info.get('previous_1_week', None)
        prev_month = current_info.get('previous_1_month', None)
        prev_year  = current_info.get('previous_1_year', None)

        st.markdown("#### 📌 현재 상태")
        kpi_cols = st.columns(4)

        with kpi_cols[0]:
            st.markdown(f"""
            <div style='padding:16px; background:{current_color}22; border:2px solid {current_color};
                        border-radius:10px; text-align:center;'>
                <div style='font-size:32px; font-weight:bold; color:{current_color};'>{latest_score:.1f}</div>
                <div style='color:white; font-size:14px; margin-top:4px;'>{latest_rating.title()}</div>
                <div style='color:#9ca3af; font-size:12px;'>현재 값</div>
            </div>""", unsafe_allow_html=True)

        labels = [("1주 전", prev_week), ("1개월 전", prev_month), ("1년 전", prev_year)]
        for i, (label, val) in enumerate(labels):
            with kpi_cols[i + 1]:
                if val is not None:
                    diff = latest_score - val
                    diff_color = "#4ade80" if diff >= 0 else "#f87171"
                    diff_str = f"{'▲' if diff >= 0 else '▼'} {abs(diff):.1f}"
                    c = rating_to_color(
                        'extreme fear' if val < 25 else 'fear' if val < 45 else
                        'neutral' if val < 55 else 'greed' if val < 75 else 'extreme greed'
                    )
                    st.markdown(f"""
                    <div style='padding:16px; background:#1e1e1e; border:1px solid #374151;
                                border-radius:10px; text-align:center;'>
                        <div style='font-size:28px; font-weight:bold; color:{c};'>{val:.1f}</div>
                        <div style='color:{diff_color}; font-size:13px; margin-top:4px;'>{diff_str}</div>
                        <div style='color:#9ca3af; font-size:12px;'>{label}</div>
                    </div>""", unsafe_allow_html=True)
                else:
                    st.markdown(f"""
                    <div style='padding:16px; background:#1e1e1e; border:1px solid #374151;
                                border-radius:10px; text-align:center;'>
                        <div style='font-size:28px; color:#6b7280;'>—</div>
                        <div style='color:#9ca3af; font-size:12px;'>{label}</div>
                    </div>""", unsafe_allow_html=True)

        st.markdown("---")

        # ── 날짜 필터 ──
        st.markdown("#### 🗓️ 기간 필터")
        filter_cols = st.columns([3, 1])
        with filter_cols[0]:
            date_range_opt = st.select_slider(
                "조회 기간 선택",
                options=["3개월", "6개월", "1년", "2년", "3년", "5년", "전체"],
                value="전체",
                label_visibility="collapsed"
            )
        with filter_cols[1]:
            show_sp500 = st.checkbox("S&P 500 오버레이", value=True)

        range_map = {"3개월": 90, "6개월": 180, "1년": 365, "2년": 730,
                     "3년": 1095, "5년": 1825, "전체": None}
        days_filter = range_map[date_range_opt]

        df_fg_filtered = df_fg.copy()
        df_sp500_filtered = df_sp500.copy() if df_sp500 is not None else None

        if days_filter is not None:
            cutoff = datetime.now() - timedelta(days=days_filter)
            df_fg_filtered = df_fg_filtered[df_fg_filtered['date'] >= cutoff]
            if df_sp500_filtered is not None:
                df_sp500_filtered = df_sp500_filtered[df_sp500_filtered['date'] >= cutoff]

        # ── 메인 히스토리 차트 ──
        st.markdown("#### 📊 Fear & Greed 히스토리 차트")
        fig_main = create_fg_history_chart(
            df_fg_filtered,
            df_sp500_filtered if show_sp500 else None
        )
        if fig_main:
            st.plotly_chart(fig_main, use_container_width=True)

        st.markdown("---")

        # ── 분석 차트 2열 레이아웃 ──
        st.markdown("#### 🔍 상세 분석")
        analysis_col1, analysis_col2 = st.columns(2)

        with analysis_col1:
            fig_dist = create_fg_distribution_chart(df_fg_filtered)
            if fig_dist:
                st.plotly_chart(fig_dist, use_container_width=True)

        with analysis_col2:
            fig_rolling = create_fg_rolling_chart(df_fg_filtered)
            if fig_rolling:
                st.plotly_chart(fig_rolling, use_container_width=True)

        # ── 세부 구성 지표 ──
        st.markdown("---")
        st.markdown("#### 📉 구성 지표 히스토리")
        st.caption("VIX, Put/Call Ratio, Junk Bond Spread 등 Fear & Greed 계산에 사용되는 세부 지표")

        # 필터 적용된 데이터로 구성
        filtered_history = dict(history_data)
        if days_filter is not None:
            cutoff = datetime.now() - timedelta(days=days_filter)
            for key in ['vix', 'put_call', 'junk_bond']:
                if key in filtered_history and filtered_history[key] is not None:
                    col_name = {'vix': 'vix', 'put_call': 'ratio', 'junk_bond': 'spread'}[key]
                    filtered_history[key] = filtered_history[key][filtered_history[key]['date'] >= cutoff]

        fig_sub = create_fg_sub_indicators_chart(filtered_history)
        if fig_sub:
            st.plotly_chart(fig_sub, use_container_width=True)
        else:
            st.info("세부 구성 지표 데이터를 불러올 수 없습니다.")

        # ── 통계 요약 테이블 ──
        st.markdown("---")
        with st.expander("📋 구간별 통계 상세 보기"):
            rating_order = ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed']
            rating_labels_ko = {
                'extreme fear': '극도의 공포', 'fear': '공포',
                'neutral': '중립', 'greed': '탐욕', 'extreme greed': '극도의 탐욕'
            }
            stats_rows = []
            for r in rating_order:
                subset = df_fg_filtered[df_fg_filtered['rating'].str.lower() == r]
                if len(subset) > 0:
                    stats_rows.append({
                        '구간': f"{rating_labels_ko[r]} ({r.title()})",
                        '일수': len(subset),
                        '비율': f"{len(subset)/len(df_fg_filtered)*100:.1f}%",
                        '평균 점수': f"{subset['score'].mean():.1f}",
                        '최소': f"{subset['score'].min():.1f}",
                        '최대': f"{subset['score'].max():.1f}",
                    })

            if stats_rows:
                df_stats = pd.DataFrame(stats_rows)
                st.dataframe(df_stats, hide_index=True, use_container_width=True)

            st.markdown(f"""
            **전체 기간 통계** (필터 기간: {date_range_opt})
            - 총 데이터: **{len(df_fg_filtered):,}일**
            - 평균 점수: **{df_fg_filtered['score'].mean():.1f}**
            - 중앙값: **{df_fg_filtered['score'].median():.1f}**
            - 최고점: **{df_fg_filtered['score'].max():.1f}** ({df_fg_filtered.loc[df_fg_filtered['score'].idxmax(), 'date'].strftime('%Y-%m-%d')})
            - 최저점: **{df_fg_filtered['score'].min():.1f}** ({df_fg_filtered.loc[df_fg_filtered['score'].idxmin(), 'date'].strftime('%Y-%m-%d')})
            """)

        st.caption("데이터 출처: CNN Business Fear & Greed Index")

        # ══════════════════════════════════════════════════════════════
        # 🔮  TabPFN-TS AI 예측 섹션
        # ══════════════════════════════════════════════════════════════
        st.markdown("---")
        st.subheader("🔮 TabPFN-TS AI 예측")
        st.caption(
            "tabpfn-time-series | NeurIPS 2024 채택 · GIFT-EVAL 1위 · "
            "Zero-Shot 시계열 예측 · 신뢰구간 포함"
        )

        # ── 설치 버전 확인 ──
        (ts_major, ts_minor, _), ts_ver_str = _get_tabpfn_ts_version()
        ts_installed = (ts_major, ts_minor) != (0, 0)

        if not ts_installed:
            st.error(
                "❌ `tabpfn-time-series` 패키지가 설치되지 않았습니다.  "
                "requirements.txt에 아래 줄을 추가하고 재배포하세요."
            )
            st.code("tabpfn-time-series>=1.0.0", language="text")
        elif ts_major < 1:
            st.warning(
                f"⚠️ 설치된 버전 **tabpfn-time-series=={ts_ver_str}** 은 구버전입니다.  "
                f"포인트 예측만 지원되며 신뢰구간이 없습니다.  "
                f"신뢰구간·최신 API를 사용하려면 아래와 같이 업그레이드하세요."
            )
            st.code("tabpfn-time-series>=1.0.0", language="text")
        else:
            st.success(f"✅ tabpfn-time-series **{ts_ver_str}** 설치됨 · 신뢰구간 예측 지원")

        if not TABPFN_TOKEN:
            st.warning(
                "⚠️ TabPFN 예측을 사용하려면 Streamlit Secrets에 "
                "**TABPFN_API_TOKEN**을 설정하세요."
            )
            with st.expander("📌 설정 방법 보기"):
                st.markdown("""
**① API 토큰 발급 (무료)**
1. [https://ux.priorlabs.ai](https://ux.priorlabs.ai) 접속 → 회원가입
2. 대시보드에서 API 토큰 발급

**② Streamlit Secrets 설정**
Streamlit Cloud → 앱 → Settings → Secrets 에 아래 내용 추가:
```toml
FRED_API_KEY      = "your_fred_key"
TABPFN_API_TOKEN  = "your_tabpfn_token"
```

**③ requirements.txt 업데이트**
```
tabpfn-time-series>=1.0.0
```

**기능 설명:**
- Fear & Greed Index 및 S&P 500 의 미래 N일을 AI로 예측
- 80% 신뢰구간 (10%~90%) 및 50% 신뢰구간 (25%~75%) 자동 표시 (v1.x 이상)
- GPU 불필요 · TabPFN Cloud API 사용
                """)
        elif ts_installed:
            # ── 컨트롤 ──
            fc_c1, fc_c2, fc_c3, fc_c4 = st.columns(4)
            with fc_c1:
                fc_target = st.selectbox(
                    "예측 대상", ["Fear & Greed Index", "S&P 500", "둘 다"],
                    key="fc_target",
                )
            with fc_c2:
                pred_len = st.selectbox(
                    "예측 기간",
                    [7, 14, 30, 60],
                    index=2,
                    format_func=lambda x: f"{x}일",
                    key="fc_pred_len",
                )
            with fc_c3:
                train_window = st.selectbox(
                    "학습 기간",
                    [180, 365, 730, 0],
                    index=1,
                    format_func=lambda x: "전체" if x == 0 else f"최근 {x}일",
                    key="fc_train_window",
                )
            with fc_c4:
                st.markdown("<br>", unsafe_allow_html=True)
                run_btn = st.button(
                    "🚀 예측 실행",
                    type="primary",
                    key="run_forecast_btn",
                    use_container_width=True,
                )

            ci_note = "예측값 + 80%·50% 신뢰구간" if ts_major >= 1 else "예측값만 (신뢰구간은 v1.x 이상)"
            # ── 예측 정보 배너 ──
            st.info(
                f"📋 학습: 최근 **{'전체' if train_window==0 else f'{train_window}일'}** 데이터 → "
                f"미래 **{pred_len}일** 예측 | "
                f"모델: TabPFN-TS v{ts_ver_str} | "
                f"{ci_note}"
            )

            if run_btn:
                # ─────────────────────────────────────────
                # 예측 대상 목록 결정
                # ─────────────────────────────────────────
                targets = []
                if fc_target in ("Fear & Greed Index", "둘 다"):
                    targets.append("fg")
                if fc_target in ("S&P 500", "둘 다") and df_sp500 is not None:
                    targets.append("sp500")

                if not targets:
                    st.error("S&P 500 데이터가 없습니다.")
                else:
                    for target_key in targets:
                        # ── 데이터 준비 ──
                        if target_key == "fg":
                            df_src = df_fg.dropna(subset=["score"]).sort_values("date").copy()
                            val_col = "score"
                            fc_title = f"Fear & Greed Index — TabPFN-TS {pred_len}일 예측"
                            fc_ylabel = "Fear & Greed Score"
                            fc_item = "fear_greed"
                            fc_is_fg = True
                            fc_ymin, fc_ymax = 0, 100
                        else:
                            df_src = df_sp500.dropna(subset=["price"]).sort_values("date").copy()
                            val_col = "price"
                            fc_title = f"S&P 500 — TabPFN-TS {pred_len}일 예측"
                            fc_ylabel = "S&P 500 Price"
                            fc_item = "sp500"
                            fc_is_fg = False
                            fc_ymin, fc_ymax = None, None

                        if train_window > 0:
                            cutoff = df_src["date"].max() - timedelta(days=train_window)
                            df_src = df_src[df_src["date"] >= cutoff]

                        if len(df_src) < 30:
                            st.warning(f"{fc_title}: 학습 데이터가 30일 미만입니다.")
                            continue

                        # ── 예측 실행 전 전처리 (중복·NaN 제거, 일별 정규화) ──
                        _clean_v, _clean_d = _clean_timeseries_for_tabpfn(
                            df_src[val_col].tolist(),
                            df_src["date"].dt.strftime("%Y-%m-%d").tolist(),
                        )
                        # 전처리 후 df_src 를 차트용으로도 업데이트
                        df_src = pd.DataFrame({
                            "date": pd.to_datetime(_clean_d),
                            val_col: _clean_v,
                        })

                        values_t = tuple(_clean_v)
                        dates_t  = tuple(_clean_d)

                        with st.spinner(
                            f"🧠 {fc_title} 예측 중… "
                            f"(학습 {len(df_src):,}일 → 미래 {pred_len}일 + 과거 검증 {pred_len}일)"
                        ):
                            pred_df, hist_pred_df, err = run_tabpfn_forecast(
                                values_t, dates_t, pred_len, fc_item, TABPFN_TOKEN
                            )

                        if err:
                            st.error(f"❌ {err}")
                            continue

                        # ── 차트 ──
                        fig_fc = create_forecast_chart(
                            df_hist=df_src[["date", val_col]],
                            hist_col=val_col,
                            pred_df=pred_df,
                            title=fc_title,
                            y_label=fc_ylabel,
                            is_fg=fc_is_fg,
                            y_min=fc_ymin,
                            y_max=fc_ymax,
                            hist_pred_df=hist_pred_df,
                        )
                        if fig_fc:
                            st.plotly_chart(fig_fc, use_container_width=True)
                        else:
                            st.error("차트 생성 실패 — 예측 결과를 확인하세요.")

                        # ── 예측 결과 요약 테이블 ──
                        with st.expander("📋 예측 수치 상세 보기"):
                            st.markdown("**미래 예측**")
                            summary_df = _build_forecast_summary(pred_df)
                            st.dataframe(
                                summary_df,
                                hide_index=True,
                                use_container_width=True,
                            )

                            if hist_pred_df is not None and len(hist_pred_df) > 0:
                                st.markdown("**과거 검증 예측** (실제 데이터와 비교용)")
                                hist_summary_df = _build_forecast_summary(hist_pred_df)
                                st.dataframe(
                                    hist_summary_df,
                                    hide_index=True,
                                    use_container_width=True,
                                )

                            # 예측 통계
                            point_col_sum = "target" if "target" in pred_df.columns else pred_df.columns[2]
                            fc_vals = pred_df[point_col_sum]
                            sc1, sc2, sc3, sc4 = st.columns(4)
                            sc1.metric("예측 평균", f"{fc_vals.mean():.2f}")
                            sc2.metric("예측 최대", f"{fc_vals.max():.2f}")
                            sc3.metric("예측 최소", f"{fc_vals.min():.2f}")
                            sc4.metric("예측 기간", f"{pred_len}일")

                        st.markdown("")  # 간격


if __name__ == "__main__":
    main()