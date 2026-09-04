/** Result —— OkImpl / ErrImpl 双类，链式 .map().unwrap() + TS 窄化。
 *
 *  Ok<T> 和 Err<E> 各自独立定义方法签名，Result<T,E> 为联合类型。
 */

export type UF<A, B> = (arg: A) => B;

// ---- 类型 ----

export interface Ok<T, E> {
    readonly status: true;
    readonly value: T;
    readonly msg: '';
    map<U>(f: UF<T, U>): Result<U, E>;
    mapErr<F>(_f: UF<E, F>): Result<T, F>;
    catch(_f: UF<E, T>): Result<T, E>;
    unwrap(): T;
}

export interface Err<T, E> {
    readonly status: false;
    readonly value: E;
    readonly msg: string;
    map<U>(_f: UF<T, U>): Result<U, E>;
    mapErr<F>(f: UF<E, F>): Result<T, F>;
    catch(f: UF<E, T>): Result<T, E>;
    unwrap(): never;
}

export type Result<T, E = unknown> = Ok<T, E> | Err<T, E>;
export type Ret<T, E = unknown> = Result<T, E>;
export type AsyncResult<T, E = unknown> = Promise<Result<T, E>>;
export type Aret<T, E = unknown> = AsyncResult<T, E>;

// ---- 实现 ----

class OkImpl<T, E> implements Ok<T, E> {
    readonly status = true as const;
    readonly msg = '' as const;
    constructor(public readonly value: T) { }

    map<U>(f: UF<T, U>): Result<U, E> {
        try { return new OkImpl(f(this.value)) as any; }
        catch (e) { return new ErrImpl(e) as any; }
    }
    mapErr<F>(_f: UF<E, F>): Result<T, F> { return this as any; }
    catch(_f: UF<E, T>): Result<T, E> { return this; }
    unwrap(): T { return this.value; }
}

class ErrImpl<T, E> implements Err<T, E> {
    readonly status = false as const;
    readonly msg: string;
    constructor(public readonly value: E, msg?: string) { this.msg = msg ?? ''; }

    map<U>(_f: UF<T, U>): Result<U, E> { return this as any; }
    mapErr<F>(f: UF<E, F>): Result<T, F> { return new ErrImpl(f(this.value), this.msg) as any; }
    catch(f: UF<E, T>): Result<T, E> {
        try { return new OkImpl(f(this.value)); } catch { return this; }
    }
    unwrap(): never { throw new Error(this.msg || 'unwrap failed'); }
}

// ---- 构造器 ----

export function Ok<T, E>(value: T): Ok<T, E> { return new OkImpl(value); }
export function Err<T, E>(value: E, msg?: string): Err<T, E> { return new ErrImpl(value, msg); }

// ---- async helpers ----

export const RA = <T, E = unknown>(p: Promise<T>, msg?: string): AsyncResult<T, E> => {
    return p.then(v => new OkImpl(v) as any).catch(reason => new ErrImpl(reason, msg ?? 'async catcher') as any);
};

export type MF<Args extends any[], R> = (...args: Args) => R;

export const RR = <E = unknown, Args extends any[] = any[], R = unknown>(
    f: MF<Args, R>,
): MF<Args, AsyncResult<R, E>> => {
    return ((...args: Args) => {
        try {
            const v = f(...args);
            if (v instanceof Promise) return RA<R, E>(v);
            return Promise.resolve(new OkImpl(v) as any);
        } catch (e) { return Promise.resolve(new ErrImpl(e) as any); }
    }) as any;
};

export const Ret = Object.freeze({ async: RA, try: RR });
