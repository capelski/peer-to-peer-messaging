import { deserializePeerData, serializePeerData } from './serialization';

export interface PeerToPeerHandlers {
    onConnectionClosed?: (instance: PeerToPeerMessaging) => void;
    onConnectionReady?: (instance: PeerToPeerMessaging) => void;
    onMessageReceived: (message: string, instance: PeerToPeerMessaging) => void;
}

export interface PeerToPeerOptions {
    useCompression?: boolean;
}

export enum PeerMode {
    joiner = 'joiner',
    starter = 'starter',
}

export class PeerToPeerMessaging {
    protected rtcConnection: RTCPeerConnection;
    protected localIceCandidates: RTCIceCandidate[];

    protected session: RTCSessionDescriptionInit | undefined;
    protected dataChannel: RTCDataChannel | undefined;

    protected useCompression: boolean | undefined;
    protected peerDataReadyTimeout: number | undefined;
    protected peerDataResolver: ((peerData: string) => void) | undefined;

    protected _peerMode: PeerMode | undefined;
    get peerMode() {
        return this._peerMode;
    }

    get isActive() {
        return !!this.dataChannel;
    }

    constructor(protected handlers: PeerToPeerHandlers, options?: PeerToPeerOptions) {
        this.reset(handlers, options);
    }

    /** Closes the connection and calls onConnectionClosed when done */
    closeConnection() {
        /* This will close the data channel at the same time for both peers, which
        is more reliable than the connection.onconnectionstatechange; using the
        dataChannel.onclose handler to signal the connection closing */
        this.rtcConnection.close();
    }

    /** Completes the connection and calls onConnectionReady when done */
    completeConnection(remoteData: string) {
        const remotePeerData = deserializePeerData(remoteData, this.useCompression);
        this.rtcConnection.setRemoteDescription(remotePeerData.session);
    }

    /** Joins the connection defined by remoteData and returns the data needed by
     * the other peer to complete the connection */
    async joinConnection(remoteData: string) {
        this._peerMode = PeerMode.joiner;

        const remotePeerData = deserializePeerData(remoteData, this.useCompression);
        await this.rtcConnection.setRemoteDescription(remotePeerData.session);

        for (const candidate of remotePeerData.candidates) {
            await this.rtcConnection.addIceCandidate(candidate);
        }

        const connectionPromise = new Promise<string>((resolve) => {
            this.peerDataResolver = resolve;
        });

        this.session = await this.rtcConnection.createAnswer();
        /* This will generate several ICE candidates, which will resolve the returned promise */
        await this.rtcConnection.setLocalDescription(this.session);

        return connectionPromise;
    }

    reset(handlers?: PeerToPeerHandlers, options?: PeerToPeerOptions) {
        if (handlers) {
            this.handlers = this.handlers;
        }
        if (options) {
            this.useCompression = options?.useCompression;
        }

        this.localIceCandidates = [];
        this.session = undefined;
        this.peerDataReadyTimeout = undefined;
        this.peerDataResolver = undefined;
        this._peerMode = undefined;

        this.rtcConnection = new RTCPeerConnection();

        this.rtcConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.localIceCandidates.push(event.candidate);

                if (this.peerDataReadyTimeout) {
                    clearTimeout(this.peerDataReadyTimeout);
                }
                this.peerDataReadyTimeout = window.setTimeout(() => {
                    this.peerDataResolver!(
                        serializePeerData(
                            { candidates: this.localIceCandidates, session: this.session! },
                            this.useCompression,
                        ),
                    );
                }, 300);
            }
        };

        this.rtcConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            this.setDataChannelHandlers(dataChannel);
        };
    }

    sendMessage(message: string) {
        if (this.dataChannel) {
            this.dataChannel.send(message);
            return true;
        }

        return false;
    }

    /** Starts a connection and returns the data needed by the other peer to join the connection */
    async startConnection() {
        this._peerMode = PeerMode.starter;

        const dataChannel = this.rtcConnection.createDataChannel('data-channel');
        this.setDataChannelHandlers(dataChannel);

        const connectionPromise = new Promise<string>((resolve) => {
            this.peerDataResolver = resolve;
        });

        this.session = await this.rtcConnection.createOffer();
        /* This will generate several ICE candidates, which will resolve the returned promise */
        await this.rtcConnection.setLocalDescription(this.session);

        return connectionPromise;
    }

    private setDataChannelHandlers(dataChannel: RTCDataChannel) {
        dataChannel.onopen = () => {
            this.dataChannel = dataChannel;
            this.handlers.onConnectionReady?.(this);
        };

        dataChannel.onmessage = (event) => {
            this.handlers.onMessageReceived(event.data, this);
        };

        dataChannel.onclose = () => {
            this.dataChannel = undefined;
            this.handlers.onConnectionClosed?.(this);
        };
    }
}
